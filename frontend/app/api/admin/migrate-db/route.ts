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
import { ApiErrors } from '@/lib/api/api-responses';
import { exportDatabase, atomicImport } from '@/lib/database/import-export';
import { validateInitData } from '@/lib/database/validation';
import { getDataVersion, getSchemaVersion, setDataVersion, setSchemaVersion } from '@/lib/database/config-db';
import { applyMigrations, getTargetVersions, needsSchemaMigration, MIGRATIONS } from '@/lib/database/migrations';
import { LATEST_SCHEMA_VERSION } from '@/lib/database/constants';
import { DB_PATH, getDbType } from '@/lib/database/db-config';
import { createAdapter } from '@/lib/database/adapter/factory';
import fs from 'fs';

export const POST = withAuth(async (request: NextRequest, user) => {
  // Check admin permission
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    // Parse request body for force parameter
    let force = false;
    try {
      const body = await request.json();
      force = body?.force === true;
    } catch {
      // No body or invalid JSON - proceed without force
    }

    const dbType = getDbType();

    // Check if database exists (SQLite only - PostgreSQL assumes DB exists)
    if (dbType === 'sqlite' && !fs.existsSync(DB_PATH)) {
      return NextResponse.json({
        success: false,
        errors: ['No database found'],
        warnings: []
      }, { status: 400 });
    }

    // Get current versions
    const db = dbType === 'sqlite'
      ? await createAdapter({ type: 'sqlite', sqlitePath: DB_PATH })
      : await createAdapter({ type: 'postgres', postgresConnectionString: process.env.POSTGRES_URL });
    const currentDataVersion = await getDataVersion(db);
    const currentSchemaVersion = await getSchemaVersion(db);
    const { dataVersion: targetDataVersion, schemaVersion: targetSchemaVersion } = getTargetVersions();
    await db.close();

    // Check if migrations are needed
    const needsDataMigration = currentDataVersion < targetDataVersion;
    const needsSchemaRecreation = needsSchemaMigration(currentSchemaVersion);

    if (!needsDataMigration && !needsSchemaRecreation && !force) {
      return NextResponse.json({
        success: true,
        message: 'Database is already up to date',
        migrations: [],
        versions: {
          current: {
            data: currentDataVersion,
            schema: currentSchemaVersion
          },
          target: {
            data: targetDataVersion,
            schema: targetSchemaVersion
          }
        },
        validation: {
          valid: true,
          errors: [],
          warnings: []
        }
      });
    }

    // Export current data
    const exportedData = await exportDatabase(DB_PATH);

    // Apply data migrations
    const migratedData = applyMigrations(exportedData, currentDataVersion);

    // Collect applied migrations for reporting
    const appliedMigrations: string[] = [];
    MIGRATIONS.forEach(m => {
      if (m.dataVersion && m.dataVersion > currentDataVersion && m.dataVersion <= targetDataVersion) {
        appliedMigrations.push(`${m.description} (data v${m.dataVersion})`);
      }
      if (m.schemaVersion && m.schemaVersion > currentSchemaVersion && m.schemaVersion <= targetSchemaVersion) {
        appliedMigrations.push(`${m.description} (schema v${m.schemaVersion})`);
      }
    });

    // Validate migrated data
    const validation = validateInitData(migratedData);

    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        errors: ['Migration failed: Migrated data is invalid', ...validation.errors],
        warnings: validation.warnings,
        migrations: appliedMigrations,
        versions: {
          current: {
            data: currentDataVersion,
            schema: currentSchemaVersion
          },
          target: {
            data: targetDataVersion,
            schema: targetSchemaVersion
          }
        }
      }, { status: 400 });
    }

    // Re-import with atomic swap (recreates DB if schema changed)
    await atomicImport(migratedData, DB_PATH);

    // Update version markers
    const newDb = dbType === 'sqlite'
      ? await createAdapter({ type: 'sqlite', sqlitePath: DB_PATH })
      : await createAdapter({ type: 'postgres', postgresConnectionString: process.env.POSTGRES_URL });
    await setDataVersion(targetDataVersion, newDb);
    await setSchemaVersion(LATEST_SCHEMA_VERSION, newDb);
    await newDb.close();

    // Reinitialize connections on Python backend
    try {
      const authUrl = process.env.AUTH_URL || 'http://localhost:3000';
      const response = await fetch(`${authUrl}/api/connections/reinitialize`, {
        method: 'POST'
      });

      if (!response.ok) {
        console.warn('Warning: Failed to reinitialize connections');
      }
    } catch (error: any) {
      console.warn(`Warning: Could not reach backend to reinitialize connections: ${error.message}`);
    }

    // Determine success message
    const isEmptyMigration = force && appliedMigrations.length === 0;
    const successMessage = isEmptyMigration
      ? 'Empty migration completed successfully (exported and re-imported data)'
      : 'Migrations completed successfully';

    return NextResponse.json({
      success: true,
      message: successMessage,
      migrations: appliedMigrations,
      versions: {
        current: {
          data: targetDataVersion,
          schema: targetSchemaVersion
        },
        target: {
          data: targetDataVersion,
          schema: targetSchemaVersion
        }
      },
      validation: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings
      }
    });
  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json({
      success: false,
      errors: [error.message],
      warnings: []
    }, { status: 500 });
  }
});
