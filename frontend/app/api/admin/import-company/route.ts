/**
 * Admin-only API endpoint for importing/overwriting company data
 * POST /api/admin/import-company
 *
 * Company-scoped import that replaces the current user's company data
 * Only accepts files with exactly 1 company matching the admin's company ID
 * Performs atomic swap: keeps other companies, replaces current company
 * Requires admin role
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors } from '@/lib/api/api-responses';
import {
  atomicImport,
  InitData,
  CompanyData
} from '@/lib/database/import-export';
import { validateInitData } from '@/lib/database/validation';
import { getDataVersion } from '@/lib/database/config-db';
import { DB_PATH } from '@/lib/database/db-config';
import { gunzip } from 'zlib';
import { promisify } from 'util';

const gunzipAsync = promisify(gunzip);

export const POST = withAuth(async (request: NextRequest, user) => {
  // Check admin permission
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    const companyId = user.companyId;
    if (!companyId) {
      return ApiErrors.badRequest('Company ID not found in user session');
    }

    // Parse uploaded file
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({
        success: false,
        errors: ['No file provided']
      }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Detect gzip and decompress
    const isGzipped = file.name.endsWith('.gz') ||
                     (fileBuffer[0] === 0x1f && fileBuffer[1] === 0x8b);
    const fileContent = isGzipped
      ? (await gunzipAsync(fileBuffer)).toString('utf-8')
      : fileBuffer.toString('utf-8');

    let uploadedData: InitData;
    try {
      uploadedData = JSON.parse(fileContent);
    } catch (parseError: any) {
      return NextResponse.json({
        success: false,
        errors: [`Invalid JSON: ${parseError.message}`]
      }, { status: 400 });
    }

    // VALIDATION 1: Must have exactly 1 company
    if (!uploadedData.companies || uploadedData.companies.length !== 1) {
      return NextResponse.json({
        success: false,
        errors: ['File must contain exactly 1 company']
      }, { status: 400 });
    }

    // VALIDATION 2: Must match current DB version
    const currentVersion = await getDataVersion();
    if (uploadedData.version !== currentVersion) {
      return NextResponse.json({
        success: false,
        errors: [
          `Version mismatch: File is v${uploadedData.version}, database is v${currentVersion}`,
          'Please use CLI tools for migrations'
        ]
      }, { status: 400 });
    }

    // VALIDATION 3: Company ID must match user's company
    const uploadedCompany = uploadedData.companies[0] as CompanyData;
    if (uploadedCompany.id !== companyId) {
      return NextResponse.json({
        success: false,
        errors: [
          `Company ID mismatch: You are admin of company ${companyId}, but file contains company ${uploadedCompany.id}`
        ]
      }, { status: 400 });
    }

    // VALIDATION 4: Data integrity
    const validation = validateInitData(uploadedData);
    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        errors: validation.errors,
        warnings: validation.warnings
      }, { status: 400 });
    }

    // SURGICAL IMPORT: Replace only this company, keep all others
    // No need to export/merge manually - atomicImport handles it!
    await atomicImport(uploadedData, DB_PATH, [companyId]);

    // Reset adapter to ensure fresh connection for next request
    // WAL checkpoint happens automatically when connection is closed
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    return NextResponse.json({
      success: true,
      message: 'Company data replaced successfully',
      company: {
        id: uploadedCompany.id,
        name: uploadedCompany.name,
        users: uploadedCompany.users.length,
        documents: uploadedCompany.documents.length
      },
      warnings: validation.warnings
    });
  } catch (error: any) {
    console.error('Import company error:', error);
    return NextResponse.json({
      success: false,
      errors: [error.message]
    }, { status: 500 });
  }
});
