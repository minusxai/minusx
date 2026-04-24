/**
 * Admin-only API endpoint for running database migrations
 * POST /api/admin/migrate-db
 *
 * Runs migrations on existing database
 * Returns migration results with validation
 * Requires admin role
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { exportDatabase, atomicImport } from '@/lib/database/import-export';
import { validateInitData } from '@/lib/database/validation';
import { getDataVersion, getSchemaVersion, setDataVersion, setSchemaVersion } from '@/lib/database/config-db';
import { applyMigrations, getTargetVersions, needsSchemaMigration, MIGRATIONS } from '@/lib/database/migrations';
import { LATEST_SCHEMA_VERSION } from '@/lib/database/constants';

export const POST = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    let force = false;
    try {
      const body = await request.json();
      force = body?.force === true;
    } catch {
      // No body or invalid JSON - proceed without force
    }

    const currentDataVersion = await getDataVersion();
    const currentSchemaVersion = await getSchemaVersion();
    const { dataVersion: targetDataVersion, schemaVersion: targetSchemaVersion } = getTargetVersions();

    const needsDataMigration = currentDataVersion < targetDataVersion;
    const needsSchemaRecreation = needsSchemaMigration(currentSchemaVersion);

    if (!needsDataMigration && !needsSchemaRecreation && !force) {
      return NextResponse.json({
        success: true,
        message: 'Database is already up to date',
        migrations: [],
        versions: {
          current: { data: currentDataVersion, schema: currentSchemaVersion },
          target: { data: targetDataVersion, schema: targetSchemaVersion }
        },
        validation: { valid: true, errors: [], warnings: [] }
      });
    }

    const exportedData = await exportDatabase();

    const migratedData = applyMigrations(exportedData, currentDataVersion);

    const appliedMigrations: string[] = [];
    MIGRATIONS.forEach(m => {
      if (m.dataVersion && m.dataVersion > currentDataVersion && m.dataVersion <= targetDataVersion) {
        appliedMigrations.push(`${m.description} (data v${m.dataVersion})`);
      }
      if (m.schemaVersion && m.schemaVersion > currentSchemaVersion && m.schemaVersion <= targetSchemaVersion) {
        appliedMigrations.push(`${m.description} (schema v${m.schemaVersion})`);
      }
    });

    const validation = validateInitData(migratedData);

    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        errors: ['Migration failed: Migrated data is invalid', ...validation.errors],
        warnings: validation.warnings,
        migrations: appliedMigrations,
        versions: {
          current: { data: currentDataVersion, schema: currentSchemaVersion },
          target: { data: targetDataVersion, schema: targetSchemaVersion }
        }
      }, { status: 400 });
    }

    await atomicImport(migratedData);

    await setDataVersion(targetDataVersion);
    await setSchemaVersion(LATEST_SCHEMA_VERSION);

    const isEmptyMigration = force && appliedMigrations.length === 0;
    const successMessage = isEmptyMigration
      ? 'Empty migration completed successfully (exported and re-imported data)'
      : 'Migrations completed successfully';

    return NextResponse.json({
      success: true,
      message: successMessage,
      migrations: appliedMigrations,
      versions: {
        current: { data: targetDataVersion, schema: targetSchemaVersion },
        target: { data: targetDataVersion, schema: targetSchemaVersion }
      },
      validation: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings
      }
    });
  } catch (error: any) {
    console.error('Migration error:', error);
    return handleApiError(error);
  }
});
