/**
 * Admin-only API endpoint for exporting current company's data
 * GET /api/admin/export-db
 *
 * Exports current user's company data to JSON format with validation metadata
 * Always exports the company the authenticated admin belongs to
 * Requires admin role
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors } from '@/lib/api/api-responses';
import { exportDatabase, CompanyData } from '@/lib/database/import-export';
import { validateInitData } from '@/lib/database/validation';
import { DB_PATH } from '@/lib/database/db-config';
import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);

export const GET = withAuth(async (request: NextRequest, user) => {
  // Check admin permission
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    // Always export current user's company only
    const companyId = user.companyId;
    if (!companyId) {
      return ApiErrors.badRequest('Company ID not found in user session');
    }

    // Export using core function with company filter (efficient SQL-level filtering)
    const exportData = await exportDatabase(DB_PATH, companyId);

    // Verify company was found
    if (exportData.companies.length === 0) {
      return NextResponse.json({
        success: false,
        errors: [`Company with ID ${companyId} not found`]
      }, { status: 404 });
    }

    // Use finalData for consistency with rest of code
    const finalData = exportData;

    // Validate export (but allow even if invalid - user preference)
    const validation = validateInitData(finalData);

    // Compress JSON with gzip
    const jsonString = JSON.stringify(finalData, null, 2);
    const compressed = await gzipAsync(Buffer.from(jsonString, 'utf-8'));

    // Determine filename with company info
    const filename = `atlas_export_company_${companyId}_${new Date().toISOString().split('T')[0]}.json.gz`;

    // Add validation status and stats to response headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    };

    // Add export stats
    const companiesArray = finalData.companies as CompanyData[];
    headers['X-Export-Stats'] = JSON.stringify({
      companies: companiesArray.length,
      users: companiesArray.reduce((sum, c) => sum + c.users.length, 0),
      documents: companiesArray.reduce((sum, c) => sum + c.documents.length, 0)
    });

    if (!validation.valid) {
      headers['X-Validation-Status'] = 'invalid';
      headers['X-Validation-Errors'] = JSON.stringify(validation.errors);
      console.warn('⚠️  Exporting invalid database:', validation.errors);
    } else {
      headers['X-Validation-Status'] = 'valid';
    }

    if (validation.warnings.length > 0) {
      headers['X-Validation-Warnings'] = JSON.stringify(validation.warnings);
    }

    // Return as downloadable gzipped JSON with validation metadata
    return new NextResponse(compressed, {
      status: 200,
      headers
    });
  } catch (error: any) {
    console.error('Export error:', error);
    return NextResponse.json({
      success: false,
      errors: [error.message]
    }, { status: 500 });
  }
});
