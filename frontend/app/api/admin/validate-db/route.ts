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
import { getDbType } from '@/lib/database/db-config';
import { createAdapter } from '@/lib/database/adapter/factory';
import { POSTGRES_URL } from '@/lib/config';

export const GET = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    const dbType = getDbType();
    const db = dbType === 'pglite'
      ? await createAdapter({ type: 'pglite' })
      : await createAdapter({ type: 'postgres', postgresConnectionString: POSTGRES_URL });
    const currentDataVersion = await getDataVersion(db);
    const currentSchemaVersion = await getSchemaVersion(db);
    await db.close();

    const { dataVersion: targetDataVersion, schemaVersion: targetSchemaVersion } = getTargetVersions();

    const exportData = await exportDatabase();
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
