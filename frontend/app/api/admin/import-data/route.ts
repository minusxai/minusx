/**
 * Admin-only API endpoint for importing data
 * POST /api/admin/import-data
 *
 * Imports users and documents from an uploaded JSON/gzip file.
 * Performs atomic replacement of all data.
 * Requires admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors, handleApiError } from '@/lib/api/api-responses';
import {
  atomicImport,
  InitData,
} from '@/lib/database/import-export';
import { validateInitData } from '@/lib/database/validation';
import { getDataVersion } from '@/lib/database/config-db';
import { applyMigrations } from '@/lib/database/migrations';
import { MINIMUM_SUPPORTED_DATA_VERSION } from '@/lib/database/constants';
import { gunzip } from 'zlib';
import { promisify } from 'util';

const gunzipAsync = promisify(gunzip);

export const POST = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ success: false, errors: ['No file provided'] }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const isGzipped = file.name.endsWith('.gz') ||
                     (fileBuffer[0] === 0x1f && fileBuffer[1] === 0x8b);
    const fileContent = isGzipped
      ? (await gunzipAsync(fileBuffer)).toString('utf-8')
      : fileBuffer.toString('utf-8');

    let uploadedData: InitData;
    try {
      uploadedData = JSON.parse(fileContent);
    } catch (parseError: any) {
      return NextResponse.json(
        { success: false, errors: [`Invalid JSON: ${parseError.message}`] },
        { status: 400 }
      );
    }

    const currentVersion = await getDataVersion();
    const fileVersion = uploadedData.version;

    if (fileVersion < MINIMUM_SUPPORTED_DATA_VERSION) {
      return NextResponse.json({
        success: false,
        errors: [
          `File is v${fileVersion}, minimum supported version is v${MINIMUM_SUPPORTED_DATA_VERSION}. Re-export from a newer system.`,
        ],
      }, { status: 400 });
    }

    if (fileVersion > currentVersion) {
      return NextResponse.json({
        success: false,
        errors: [
          `File is v${fileVersion}, database is v${currentVersion}. Downgrade is not supported.`,
        ],
      }, { status: 400 });
    }

    let importData = uploadedData;
    const migratedFrom = fileVersion < currentVersion ? fileVersion : undefined;

    if (migratedFrom !== undefined) {
      try {
        importData = applyMigrations(uploadedData, fileVersion);
        importData.version = currentVersion;
      } catch (migrationError: any) {
        return NextResponse.json({
          success: false,
          errors: [`Migration failed: ${migrationError?.message ?? String(migrationError)}`],
        }, { status: 400 });
      }
    }

    // Validate data integrity
    const validation = validateInitData(importData);
    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        errors: validation.errors,
        warnings: validation.warnings,
      }, { status: 400 });
    }

    await atomicImport(importData);

    return NextResponse.json({
      success: true,
      message: 'Data imported successfully',
      ...(migratedFrom !== undefined && { migratedFrom }),
      stats: {
        users: importData.users?.length ?? 0,
        documents: importData.documents?.length ?? 0,
      },
      warnings: validation.warnings,
    });
  } catch (error: any) {
    console.error('Import error:', error);
    return handleApiError(error);
  }
});
