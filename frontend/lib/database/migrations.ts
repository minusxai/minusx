/**
 * Database migration registry and utilities
 * Supports both data format migrations and schema changes
 */

import { InitData, OrgData } from './import-export';
import { LATEST_DATA_VERSION, LATEST_SCHEMA_VERSION, MINIMUM_SUPPORTED_DATA_VERSION } from './constants';
import { immutableSet } from '@/lib/utils/immutable-collections';
import workspaceTemplate from './workspace-template.json';
import { remapStoryQuestionIds } from '@/lib/data/story/story-question';
import { vizSettingsToEnvelopeStatic } from '@/lib/viz/from-vizsettings';
import type { QuestionContent, NotebookContent } from '@/lib/types';

type DataMigration = (data: InitData) => InitData;
type SchemaMigration = null;  // Null means "recreate DB with new schema"

/** A single files-table row as seen by a row migration. */
export interface RowMigrationRow {
  id: number;
  type: string;
  content: unknown;
}

/**
 * Streaming per-row form of a migration, for migrations that only rewrite the
 * `content` of specific file types. The runner scans just those types in batches
 * and UPDATEs changed rows in place — it never exports the whole DB into memory
 * (the whole-DB `dataMigration` path OOMs on production-sized files tables).
 * Must be idempotent: re-running on already-migrated rows returns null.
 */
export interface RowMigration {
  /** File types this migration touches; rows of other types are never read. */
  types: readonly string[];
  /** Return the new content for the row, or null when the row is unchanged. */
  migrateContent(row: RowMigrationRow): unknown | null;
}

export interface MigrationEntry {
  dataVersion?: number;      // Target data version (if data format changes)
  schemaVersion?: number;    // Target schema version (if schema changes)
  dataMigration?: DataMigration;
  /**
   * Optional streaming equivalent of dataMigration. When every pending migration
   * provides one, startup migrates row-by-row instead of export→import. Both forms
   * must produce identical content — dataMigration remains the path for imports of
   * old exports (applyMigrations).
   */
  rowMigration?: RowMigration;
  schemaMigration?: SchemaMigration;  // null = recreate DB
  description: string;
}

// Template IDs (1–999 range) — these are never renumbered.
const TEMPLATE_IDS = immutableSet(
  (workspaceTemplate.documents as { id: number }[]).map(d => d.id)
);

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
/**
 * V37 — Viz Arch V2: add a `viz` envelope to every question and notebook SQL cell
 * that lacks one, derived FILE-LEVEL from its `vizSettings` (no query execution —
 * column kinds come from vizSettingsToEnvelopeStatic's conservative name heuristic).
 *
 * Non-destructive by design: `vizSettings` is NEVER modified (it remains the V1
 * rollback path if the vizV2 format default is switched back), and an existing
 * `viz` is never overwritten (hand-authored envelopes win). The Data Management
 * "Backfill Viz V2 Envelopes" action is the re-runnable overwrite variant.
 */
function v37QuestionContent(content: QuestionContent): QuestionContent | null {
  if (content?.vizSettings == null || content.viz != null) return null;
  try {
    return { ...content, viz: vizSettingsToEnvelopeStatic(content.vizSettings, content.query) };
  } catch {
    return null; // an unconvertible vizSettings keeps rendering via the runtime bridge
  }
}

function v37NotebookContent(content: NotebookContent): NotebookContent | null {
  if (!Array.isArray(content?.cells)) return null;
  let changed = false;
  const cells = content.cells.map(cell => {
    if (cell.type !== 'sql' || cell.vizSettings == null || cell.viz != null) return cell;
    try {
      const viz = vizSettingsToEnvelopeStatic(cell.vizSettings, cell.query);
      changed = true;
      return { ...cell, viz };
    } catch {
      return cell;
    }
  });
  return changed ? { ...content, cells } : null;
}

function v37MigrateRowContent(row: RowMigrationRow): unknown | null {
  if (row.type === 'question') return v37QuestionContent(row.content as QuestionContent);
  if (row.type === 'notebook') return v37NotebookContent(row.content as NotebookContent);
  return null;
}

function v37AddVizEnvelopes(data: InitData): InitData {
  const documents = (data.documents ?? []).map(doc => {
    const next = v37MigrateRowContent(doc);
    return next != null ? { ...doc, content: next as typeof doc.content } : doc;
  });
  return { ...data, documents };
}

/**
 * V38 — Strip retired schema-drift from stored config documents.
 *
 * Config types evolve; existing stored configs can reference values we've
 * retired, which then fail validation and (pre-fix) bricked the whole config.
 * This migration cleans the KNOWN retired values in place, once:
 *   - retired file types (denylist below) removed from `supportedFileTypes`
 *     and every `accessRules.<role>.{allowedTypes,createTypes,viewTypes}`;
 *   - the retired `llm.assignments` shape dropped (its `providers` are kept).
 * When you retire another file type, add it to the denylist (or write a V39).
 */
const V38_RETIRED_FILE_TYPES = immutableSet(['conversation']);

function v38StripRetired(arr: unknown): { value: unknown; changed: boolean } {
  if (!Array.isArray(arr)) return { value: arr, changed: false };
  const filtered = arr.filter(t => !(typeof t === 'string' && V38_RETIRED_FILE_TYPES.has(t)));
  return { value: filtered, changed: filtered.length !== arr.length };
}

function v38ConfigContent(content: unknown): Record<string, unknown> | null {
  if (!content || typeof content !== 'object') return null;
  const next: Record<string, unknown> = { ...(content as Record<string, unknown>) };
  let changed = false;

  if (Array.isArray(next.supportedFileTypes)) {
    const r = v38StripRetired(next.supportedFileTypes);
    if (r.changed) { next.supportedFileTypes = r.value; changed = true; }
  }

  if (next.accessRules && typeof next.accessRules === 'object') {
    const roles: Record<string, unknown> = { ...(next.accessRules as Record<string, unknown>) };
    let accessChanged = false;
    for (const [role, override] of Object.entries(roles)) {
      if (!override || typeof override !== 'object') continue;
      const o: Record<string, unknown> = { ...(override as Record<string, unknown>) };
      let roleChanged = false;
      for (const field of ['allowedTypes', 'createTypes', 'viewTypes']) {
        if (field in o) {
          const r = v38StripRetired(o[field]);
          if (r.changed) { o[field] = r.value; roleChanged = true; }
        }
      }
      if (roleChanged) { roles[role] = o; accessChanged = true; }
    }
    if (accessChanged) { next.accessRules = roles; changed = true; }
  }

  if (next.llm && typeof next.llm === 'object' && 'assignments' in (next.llm as Record<string, unknown>)) {
    const llm = { ...(next.llm as Record<string, unknown>) };
    delete llm.assignments;
    next.llm = llm;
    changed = true;
  }

  return changed ? next : null;
}

function v38MigrateRowContent(row: RowMigrationRow): unknown | null {
  if (row.type === 'config') return v38ConfigContent(row.content);
  return null;
}

function v38StripRetiredConfigDrift(data: InitData): InitData {
  const documents = (data.documents ?? []).map(doc => {
    const next = v38MigrateRowContent(doc);
    return next != null ? { ...doc, content: next as typeof doc.content } : doc;
  });
  return { ...data, documents };
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    dataVersion: 36,
    description: 'Shift all non-system file IDs to ≥ 1000 (reserve 1–99 for system template; /org files 100–112 also shifted)',
    dataMigration: v36ShiftUserFileIds,
  },
  {
    dataVersion: 37,
    description: 'Viz Arch V2: add file-level `viz` envelopes to questions and notebook SQL cells (vizSettings untouched; existing viz preserved)',
    dataMigration: v37AddVizEnvelopes,
    rowMigration: { types: ['question', 'notebook'], migrateContent: v37MigrateRowContent },
  },
  {
    dataVersion: 38,
    description: 'Strip retired config drift: remove retired file types (conversation) from supportedFileTypes/accessRules and drop the retired llm.assignments shape',
    dataMigration: v38StripRetiredConfigDrift,
    rowMigration: { types: ['config'], migrateContent: v38MigrateRowContent },
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
