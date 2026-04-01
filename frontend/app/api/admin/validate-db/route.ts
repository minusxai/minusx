/**
 * Admin-only API endpoint for validating database
 * GET /api/admin/validate-db
 *
 * Validates database and returns version information
 * Requires admin role
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { exportDatabase } from '@/lib/database/import-export';
import { validateInitData } from '@/lib/database/validation';
import { getDataVersion, getSchemaVersion } from '@/lib/database/config-db';
import { getTargetVersions } from '@/lib/database/migrations';
import { DB_PATH, getDbType } from '@/lib/database/db-config';
import { createAdapter } from '@/lib/database/adapter/factory';
import { POSTGRES_URL } from '@/lib/config';

export const GET = withAuth(async (request: NextRequest, user) => {
  // Check admin permission
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    // Get current versions from database
    const dbType = getDbType();
    const db = dbType === 'sqlite'
      ? await createAdapter({ type: 'sqlite', sqlitePath: DB_PATH })
      : await createAdapter({ type: 'postgres', postgresConnectionString: POSTGRES_URL });
    const currentDataVersion = await getDataVersion(db);
    const currentSchemaVersion = await getSchemaVersion(db);
    await db.close();

    // Get target versions
    const { dataVersion: targetDataVersion, schemaVersion: targetSchemaVersion } = getTargetVersions();

    // Export and validate — scoped to the authenticated user's company only
    const exportData = await exportDatabase(DB_PATH, user.companyId);
    const validation = validateInitData(exportData);

    return NextResponse.json({
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      versions: {
        current: {
          data: currentDataVersion,
          schema: currentSchemaVersion
        },
        target: {
          data: targetDataVersion,
          schema: targetSchemaVersion
        },
        upToDate: currentDataVersion === targetDataVersion && currentSchemaVersion === targetSchemaVersion
      }
    });
  } catch (error: any) {
    console.error('Validation error:', error);
    return handleApiError(error);
  }
});
