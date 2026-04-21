/**
 * Database migration registry and utilities
 * Supports both data format migrations and schema changes
 */

import { InitData, OrgData } from './import-export';
import { LATEST_DATA_VERSION, LATEST_SCHEMA_VERSION, MINIMUM_SUPPORTED_DATA_VERSION } from './constants';
import { VALID_MODES } from '@/lib/mode/mode-types';
import { convertDatabaseContextToWhitelist } from '@/lib/context/context-utils';

export type DataMigration = (data: InitData) => InitData;
export type SchemaMigration = null;  // Null means "recreate DB with new schema"

export interface MigrationEntry {
  dataVersion?: number;      // Target data version (if data format changes)
  schemaVersion?: number;    // Target schema version (if schema changes)
  dataMigration?: DataMigration;   // Function to migrate data
  schemaMigration?: SchemaMigration;  // null = recreate DB
  description: string;
}

/**
 * Migration registry. Only contains migrations from V33 onwards.
 * Data below MINIMUM_SUPPORTED_DATA_VERSION (33) is rejected — re-import from a fresh export.
 */
export const MIGRATIONS: MigrationEntry[] = [
  {
    dataVersion: 33,
    schemaVersion: undefined,
    description: 'V33: Migrate whitelist schema (ContextVersion.databases[] → whitelist tree) + create default context per folder',
    dataMigration: (data: InitData) => {
      const now = new Date().toISOString();

      for (const orgData of (data.orgs ?? []) as OrgData[]) {
        // ── Part A: Convert existing context whitelist format ──────────────────
        for (const doc of orgData.documents) {
          if (doc.type !== 'context') continue;
          const content = doc.content as any;
          if (!content?.versions) continue;

          for (const version of content.versions) {
            if (!version.databases) continue; // already migrated or no old-format data

            version.whitelist = version.databases === '*'
              ? '*'
              : convertDatabaseContextToWhitelist(version.databases);

            delete version.databases;
          }
        }

        // ── Part B: Create default context for each folder without one ─────────
        const contextPaths = new Set(
          orgData.documents.filter((d: any) => d.type === 'context').map((d: any) => d.path)
        );
        const maxId = orgData.documents.reduce(
          (max: number, d: any) => Math.max(max, d.id ?? 0), 0
        );
        let nextId = maxId;

        for (const folder of orgData.documents.filter((d: any) => d.type === 'folder')) {
          const expectedContextPath = `${folder.path}/context`;
          if (contextPaths.has(expectedContextPath)) continue;

          nextId++;
          orgData.documents.push({
            id: nextId,
            name: 'Knowledge Base',
            path: expectedContextPath,
            type: 'context',
            references: [],
            content: {
              versions: [{
                version: 1,
                whitelist: '*',
                docs: [],
                createdAt: now,
                createdBy: 1,
                description: 'Default context (migration)',
              }],
              published: { all: 1 },
            },
            created_at: now,
            updated_at: now,
            version: 1,
            last_edit_id: null,
          });
          contextPaths.add(expectedContextPath);
        }
      }

      return data;
    },
  },
  {
    dataVersion: 34,
    schemaVersion: undefined,
    dataMigration: (data: InitData) => {
      for (const orgData of (data.orgs ?? []) as OrgData[]) {
        for (const doc of orgData.documents) {
          if (doc.type === 'context' && doc.name === 'context') {
            doc.name = 'Knowledge Base';
          }
        }
      }
      return data;
    },
    description: 'V34: Rename default context files from "context" to "Knowledge Base"',
  },
  {
    dataVersion: 35,
    schemaVersion: undefined,
    dataMigration: (data: InitData) => {
      const now = new Date().toISOString();
      for (const orgData of (data.orgs ?? []) as OrgData[]) {
        const allPaths = new Set(orgData.documents.map(d => d.path));
        const folderPaths = new Set(
          orgData.documents.filter(d => d.type === 'folder').map(d => d.path)
        );

        for (const mode of VALID_MODES) {
          const databaseFolder = `/${mode}/database`;
          const staticPath = `${databaseFolder}/static`;

          if (!folderPaths.has(databaseFolder)) continue;
          if (allPaths.has(staticPath)) continue;

          const maxId = orgData.documents.reduce((max, d) => Math.max(max, d.id), 0);
          orgData.documents.push({
            id: maxId + 1,
            name: 'static',
            path: staticPath,
            type: 'connection' as const,
            references: [],
            content: {
              type: 'csv',
              config: { files: [] },
              description: 'Add your own CSV, xlsx, or Google Sheets tables here',
            },
            created_at: now,
            updated_at: now,
            version: 1,
            last_edit_id: null,
          });
          allPaths.add(staticPath);
          console.log(`  [V35] Created ${staticPath} for org "${orgData.name}"`);
        }
      }
      return data;
    },
    description: 'V35: Create missing /{mode}/database/static connection for all modes',
  },
];

/**
 * Get target versions after applying all migrations
 */
export function getTargetVersions(): { dataVersion: number; schemaVersion: number } {
  return {
    dataVersion: LATEST_DATA_VERSION,
    schemaVersion: LATEST_SCHEMA_VERSION
  };
}

/**
 * Fix known schema issues in data — runs unconditionally after every migration pass.
 * Handles both flat {users, documents} and legacy nested {orgs} format.
 */
export function fixData(data: InitData): InitData {
  const documents = data.documents ?? (data.orgs ?? []).flatMap((org: OrgData) => org.documents);
  for (const doc of documents) {
    const content = doc.content as any;
    if (!content || typeof content !== 'object') continue;

    if (doc.type === 'question') {
      const viz = content.vizSettings;
      if (viz?.type === 'pivot' && viz.pivotConfig == null) {
        viz.pivotConfig = { rows: [], columns: [], values: [] };
      }
      if (viz?.colors && !viz?.styleConfig?.colors) {
        viz.styleConfig = {
          ...(viz.styleConfig ?? {}),
          colors: viz.colors,
        };
      }
    }
  }
  return data;
}

/**
 * Apply all migrations to data starting from specified version.
 * Throws if data version is below MINIMUM_SUPPORTED_DATA_VERSION.
 */
export function applyMigrations(data: InitData, fromDataVersion: number): InitData {
  if (fromDataVersion < MINIMUM_SUPPORTED_DATA_VERSION) {
    throw new Error(
      `Data version ${fromDataVersion} is below minimum supported version ${MINIMUM_SUPPORTED_DATA_VERSION}. ` +
      `Re-import from a fresh export or contact support.`
    );
  }

  let currentData = data;
  let currentVersion = data.version || fromDataVersion;

  for (const migration of MIGRATIONS) {
    if (migration.dataVersion && migration.dataVersion > currentVersion && migration.dataMigration) {
      currentData = migration.dataMigration(currentData);
      currentData.version = migration.dataVersion;
      currentVersion = migration.dataVersion;
    }
  }

  return fixData(currentData);
}

/**
 * Check if schema migration is needed
 */
export function needsSchemaMigration(currentSchemaVersion: number): boolean {
  return MIGRATIONS.some(
    m => m.schemaVersion && m.schemaVersion > currentSchemaVersion && m.schemaMigration === null
  );
}
