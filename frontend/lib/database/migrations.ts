/**
 * Database migration registry and utilities
 * Supports both data format migrations and schema changes
 */

import { InitData, OrgData } from './import-export';
import { LATEST_DATA_VERSION, LATEST_SCHEMA_VERSION, MINIMUM_SUPPORTED_DATA_VERSION } from './constants';
import { immutableSet } from '@/lib/utils/immutable-collections';
import workspaceTemplate from './workspace-template.json';

export type DataMigration = (data: InitData) => InitData;
export type SchemaMigration = null;  // Null means "recreate DB with new schema"

export interface MigrationEntry {
  dataVersion?: number;      // Target data version (if data format changes)
  schemaVersion?: number;    // Target schema version (if schema changes)
  dataMigration?: DataMigration;
  schemaMigration?: SchemaMigration;  // null = recreate DB
  description: string;
}

// Template IDs (1–999 range) — these are never renumbered.
const TEMPLATE_IDS = immutableSet(
  (workspaceTemplate.documents as { id: number }[]).map(d => d.id)
);

/**
 * V36 — Shift user-created file IDs to ≥ 1000.
 *
 * IDs 1–999 are reserved for workspace-template files. This migration finds every
 * user-created document with an ID < 1000 (i.e. not a template file), computes
 * offset = 1000 − min(user_id) so the lowest user ID lands exactly at 1000, then
 * renumbers those documents and patches every cross-reference:
 *   - doc.references  (file_references array)
 *   - dashboard content: assets[].id, layout[].id
 */
function v36ShiftUserFileIds(data: InitData): InitData {
  const documents = data.documents ?? (data.orgs ?? []).flatMap((o: OrgData) => o.documents);

  const userDocsBelow1000 = documents.filter(d => !TEMPLATE_IDS.has(d.id) && d.id < 1000);
  if (userDocsBelow1000.length === 0) return data;

  const minId = Math.min(...userDocsBelow1000.map(d => d.id));
  // Floor at max(1000, existingMax+1) so shifted IDs never collide with docs already at ≥ 1000
  const existingAbove1000 = documents.filter(d => d.id >= 1000);
  const existingMax = existingAbove1000.length > 0 ? Math.max(...existingAbove1000.map(d => d.id)) : 999;
  const floor = Math.max(1000, existingMax + 1);
  const offset = floor - minId;

  const idMap = new Map<number, number>();
  for (const doc of userDocsBelow1000) idMap.set(doc.id, doc.id + offset);

  function remap(id: number): number { return idMap.get(id) ?? id; }

  function remapContent(content: unknown): unknown {
    if (!content || typeof content !== 'object') return content;
    const c = content as Record<string, unknown>;
    // Dashboard: remap asset IDs and layout IDs
    if (Array.isArray(c.assets)) {
      return {
        ...c,
        assets: (c.assets as Array<{ type: string; id: number }>).map(a => ({ ...a, id: remap(a.id) })),
        ...(Array.isArray(c.layout)
          ? { layout: (c.layout as Array<{ id: number } & Record<string, unknown>>).map(item => ({ ...item, id: remap(item.id) })) }
          : {}),
      };
    }
    return content;
  }

  const newDocuments = documents.map(doc => ({
    ...doc,
    id: remap(doc.id),
    references: ((doc as any).references ?? []).map((id: number) => remap(id)),
    content: remapContent(doc.content) as typeof doc.content,
  }));

  if (data.documents) return { ...data, documents: newDocuments };
  // Legacy nested format — write back into orgs
  let docIdx = 0;
  const newOrgs = (data.orgs ?? []).map((org: OrgData) => ({
    ...org,
    documents: org.documents.map(() => newDocuments[docIdx++]),
  }));
  return { ...data, orgs: newOrgs };
}

/**
 * Migration registry. All historical migrations (V33–V35) have been folded into
 * the initial seed data. MINIMUM_SUPPORTED_DATA_VERSION is now 35, so any export
 * below that version is rejected — re-import from a fresh export.
 */
export const MIGRATIONS: MigrationEntry[] = [
  {
    dataVersion: 36,
    description: 'Shift user-created file IDs to ≥ 1000 (reserve 1–999 for template)',
    dataMigration: v36ShiftUserFileIds,
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
