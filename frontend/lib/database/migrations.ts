/**
 * Database migration registry and utilities
 * Supports both data format migrations and schema changes
 */

import { InitData, OrgData } from './import-export';
import { LATEST_DATA_VERSION, LATEST_SCHEMA_VERSION, MINIMUM_SUPPORTED_DATA_VERSION } from './constants';
import { immutableSet } from '@/lib/utils/immutable-collections';
import workspaceTemplate from './workspace-template.json';
import { remapStoryQuestionIds } from '@/lib/data/story/story-question';

type DataMigration = (data: InitData) => InitData;
type SchemaMigration = null;  // Null means "recreate DB with new schema"

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
 * V37 — the static-sources / config-databases split.
 *
 * 1. Warehouse connection docs copy their spec into the mode config's
 *    `databases.connections` (names byte-identical — contexts, questions and
 *    Views keep resolving); the doc remains as the schema-cache holder.
 *    duckdb/internal_db stay file-backed (system plumbing).
 * 2. Static connections (csv / google-sheets) become DATASET docs at the mode
 *    root — same s3 keys, zero data movement; root = the same everywhere reach
 *    they had as global connections. Legacy source fields map:
 *    csv→'upload', google_sheets→'link' (+source_url / source_group).
 * 3. Every content reference to a static connection's NAME (questions,
 *    notebook cells, context whitelists) is rewritten to the virtual `files`
 *    connection.
 * 4. schema.table collisions across old static connections rename with a
 *    numeric suffix (first connection wins) — logged loudly.
 */
const V37_STATIC_TYPES = immutableSet(['csv', 'google-sheets']);
const V37_CONFIG_TYPES = immutableSet(['postgresql', 'bigquery', 'athena', 'clickhouse', 'mongo']);

function v37StaticSourcesAndConfigDatabases(data: InitData): InitData {
  const documents = data.documents ?? (data.orgs ?? []).flatMap((o: OrgData) => o.documents);
  type Doc = (typeof documents)[number];

  const modeOf = (path: string): string => path.split('/')[1] ?? 'org';
  const isConnDoc = (d: Doc): boolean => d.type === 'connection' && /^\/[^/]+\/database\/[^/]+$/.test(d.path);

  const connDocs = documents.filter(isConnDoc);
  const staticDocs = connDocs.filter((d) => V37_STATIC_TYPES.has((d.content as { type?: string })?.type ?? ''));
  const warehouseDocs = connDocs.filter((d) => V37_CONFIG_TYPES.has((d.content as { type?: string })?.type ?? ''));
  if (staticDocs.length === 0 && warehouseDocs.length === 0) return data;

  const staticNamesByMode = new Map<string, Set<string>>();
  for (const d of staticDocs) {
    const mode = modeOf(d.path);
    if (!staticNamesByMode.has(mode)) staticNamesByMode.set(mode, new Set());
    staticNamesByMode.get(mode)!.add(d.name);
  }

  // 2. Static connections → dataset docs at the mode root (collision-suffixed).
  const takenByMode = new Map<string, Set<string>>();
  const datasetDocs: Doc[] = staticDocs.map((d) => {
    const mode = modeOf(d.path);
    if (!takenByMode.has(mode)) takenByMode.set(mode, new Set());
    const taken = takenByMode.get(mode)!;
    const files = (((d.content as { config?: { files?: Array<Record<string, unknown>> } })?.config?.files) ?? []).map((f) => {
      let table = String(f.table_name ?? '');
      const schema = String(f.schema_name ?? 'public');
      if (taken.has(`${schema}.${table}`)) {
        let n = 2;
        while (taken.has(`${schema}.${table}_${n}`)) n++;
        console.warn(`[migration v37] static table ${schema}.${table} collides — renamed to ${schema}.${table}_${n} (from connection '${d.name}')`);
        table = `${table}_${n}`;
      }
      taken.add(`${schema}.${table}`);
      const isLink = f.source_type === 'google_sheets';
      return {
        filename: f.filename ?? `${table}.csv`,
        table_name: table,
        schema_name: schema,
        s3_key: f.s3_key,
        file_format: f.file_format ?? 'csv',
        row_count: f.row_count ?? 0,
        columns: f.columns ?? [],
        source: isLink ? 'link' : 'upload',
        ...(isLink && f.spreadsheet_url ? { source_url: f.spreadsheet_url } : {}),
        ...(isLink && f.spreadsheet_id ? { source_group: f.spreadsheet_id } : {}),
      };
    });
    return {
      ...d,
      // ID PRESERVED: the connection doc is removed in this same pass, so its
      // id is free — reusing it keeps template ids in the reserved range and
      // never mints ids that could collide with user files.
      path: `/${mode}/${d.name}`,
      type: 'dataset',
      content: { files } as Doc['content'],
    };
  });

  // 1. Warehouse specs → the mode config doc's databases section.
  const rewritten = documents
    .filter((d) => !staticDocs.includes(d))
    .map((d) => {
      if (d.type === 'config' && /^\/[^/]+\/configs\/config$/.test(d.path)) {
        const mode = modeOf(d.path);
        const mine = warehouseDocs.filter((w) => modeOf(w.path) === mode);
        if (mine.length === 0) return d;
        const existing = ((d.content as { databases?: { connections?: unknown[] } })?.databases?.connections ?? []) as Array<{ name?: string }>;
        const existingNames = new Set(existing.map((e) => e.name));
        const additions = mine
          .filter((w) => !existingNames.has(w.name))
          .map((w) => ({ name: w.name, type: (w.content as { type: string }).type, config: (w.content as { config?: Record<string, unknown> }).config ?? {} }));
        return { ...d, content: { ...(d.content as object), databases: { connections: [...existing, ...additions] } } as Doc['content'] };
      }

      // 3. connection_name rewrites: static names → 'files' (per mode).
      const staticNames = staticNamesByMode.get(modeOf(d.path));
      if (!staticNames || staticNames.size === 0) return d;
      const c = d.content as Record<string, unknown> | null;
      if (!c) return d;

      if ((d.type === 'question') && typeof c.connection_name === 'string' && staticNames.has(c.connection_name)) {
        return { ...d, content: { ...c, connection_name: 'files' } as Doc['content'] };
      }
      if (d.type === 'notebook' && Array.isArray(c.cells)) {
        const cells = (c.cells as Array<Record<string, unknown>>).map((cell) =>
          typeof cell.connection_name === 'string' && staticNames.has(cell.connection_name)
            ? { ...cell, connection_name: 'files' } : cell);
        return { ...d, content: { ...c, cells } as Doc['content'] };
      }
      if (d.type === 'context' && Array.isArray(c.versions)) {
        const versions = (c.versions as Array<Record<string, unknown>>).map((v) => {
          if (!Array.isArray(v.whitelist)) return v;
          const whitelist = (v.whitelist as Array<Record<string, unknown>>).map((w) =>
            typeof w.name === 'string' && staticNames.has(w.name) ? { ...w, name: 'files' } : w);
          return { ...v, whitelist };
        });
        return { ...d, content: { ...c, versions } as Doc['content'] };
      }
      return d;
    });

  return { ...data, documents: [...rewritten, ...datasetDocs], orgs: undefined, companies: undefined };
}

/**
 * V36 — Shift all non-system file IDs to ≥ 1000.
 *
 * IDs 1–99 are reserved for system template files (tutorial, internals).
 * /org structural files (originally 100–112) and all user-created files are
 * shifted so the lowest non-system ID lands at ≥ 1000. The floor is raised
 * above any IDs already ≥ 1000 to prevent collisions.
 * Patches every cross-reference:
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
    // Story: the body is the source of truth — remap the saved-question ids it embeds
    // (data-question-id) and any <Param> import sources (data-param-source-id).
    if (typeof c.story === 'string') {
      return { ...c, story: remapStoryQuestionIds(c.story, remap) };
    }
    return content;
  }

  const newDocuments = documents.map(doc => ({
    ...doc,
    id: remap(doc.id),
    // Guard with Array.isArray (not `?? []`): legacy rows can have a non-array
    // file_references (e.g. {}), which `??` won't catch → .map would throw.
    references: (Array.isArray((doc as any).references) ? (doc as any).references : []).map((id: number) => remap(id)),
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
    description: 'Shift all non-system file IDs to ≥ 1000 (reserve 1–99 for system template; /org files 100–112 also shifted)',
    dataMigration: v36ShiftUserFileIds,
  },
  {
    dataVersion: 37,
    description: 'Static sources become root dataset files; warehouse connection specs copy into config.databases; static connection_name references rewrite to files',
    dataMigration: v37StaticSourcesAndConfigDatabases,
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
    // Normalize references to an array (legacy rows can hold a non-array JSONB
    // value, e.g. {}). Runs before the content skip so it applies to every doc.
    if (!Array.isArray((doc as any).references)) (doc as any).references = [];

    const content = doc.content as any;
    if (!content || typeof content !== 'object') continue;

    if (doc.type === 'question') {
      const viz = content.vizSettings;
      if (viz?.type === 'pivot' && viz.pivotConfig == null) {
        viz.pivotConfig = { rows: [], columns: [], values: [] };
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
  // Clamp anything below minimum (including 0 for unversioned DBs) to minimum.
  // All current migrations are safe to run on any old data.
  const effectiveVersion = Math.max(fromDataVersion, MINIMUM_SUPPORTED_DATA_VERSION);

  let currentData = data;
  let currentVersion = data.version || effectiveVersion;

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
