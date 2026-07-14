/**
 * Scoped semantic-model derivation. Full models are derived PER REQUEST for
 * the tables in play, never stored on the context content — a large workspace
 * derives multi-MB of vocabulary, which must not ship in every context load
 * (see lib/semantic/derive.ts). Served by POST /api/semantic-models.
 *
 * Composition:
 *  - whitelist scope + declared relationships → nearest context for the path
 *    (table NAMES survive schema bounding, so scoping works on any size)
 *  - columns + profiled meta → the connection's persisted schema (always full)
 *  - business names → deriveModelStubs over the whole whitelisted table list,
 *    so scoped names match what the client shows globally
 */
import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { getPersistedConnectionSchema } from '@/lib/data/connections.server';
import { findNearestContextPath, getPublishedVersionForUser } from '@/lib/context/context-utils';
import { resolvePath } from '@/lib/mode/path-resolver';
import { deriveSemanticModels } from '@/lib/semantic/derive';
import { detectSemanticQuery } from '@/lib/semantic/detect-sql';
import { parseSqlToIrLocal } from '@/lib/sql/sql-to-ir';
import { connectionTypeToDialect } from '@/lib/types';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, DatabaseSchema, DatabaseWithSchema, SemanticModel, TableRelationship } from '@/lib/types';

export interface ScopedModelsParams {
  /** Folder the requesting file lives in (context resolution anchor), e.g. "/org". */
  path: string;
  /** Connection (database) name. */
  connection: string;
  /** Base tables to derive models for. */
  tables: string[];
}

async function loadNearestContext(user: EffectiveUser, basePath: string): Promise<ContextContent | null> {
  const modePath = resolvePath(user.mode, '/');
  const { data: contextFiles } = await FilesAPI.getFiles(
    { type: 'context', paths: [modePath], depth: -1 },
    user,
  );
  const nearest = findNearestContextPath(contextFiles.map((f) => f.path), basePath);
  if (!nearest) return null;
  const { data } = await FilesAPI.loadFileByPath(nearest, user);
  return (data?.content as ContextContent) ?? null;
}

interface ConnectionScope {
  schema: DatabaseSchema;
  whitelisted: Set<string>;                 // `${schema}|${table}` of every in-scope table
  namingSchemas: DatabaseWithSchema['schemas'];  // whitelisted names-only list (global naming)
  relationships: TableRelationship[];
}

/** Shared resolution: connection columns + context whitelist + relationships. */
async function resolveScope(
  user: EffectiveUser,
  path: string,
  connection: string,
): Promise<ConnectionScope | null> {
  const schema = await getPersistedConnectionSchema(connection, user);
  if (!schema) return null;

  let context: ContextContent | null = null;
  try {
    context = await loadNearestContext(user, path);
  } catch {
    context = null; // no context → scope to the connection schema directly
  }

  // Whitelisted table names for this connection (names survive bounding).
  // Without a context, every table in the connection is in scope.
  const contextDb = context?.fullSchema?.find((db) => db.databaseName === connection);
  const source = contextDb ?? { databaseName: connection, schemas: schema.schemas };
  const whitelisted = new Set<string>();
  for (const s of source.schemas ?? []) {
    for (const t of s.tables ?? []) whitelisted.add(`${s.schema}|${t.table}`);
  }

  // Inherited (fullRelationships) + the live version's own — mirrors how
  // metrics resolve (full* fields are inherited-only).
  const liveVersion = context?.versions?.find(
    (v) => v.version === getPublishedVersionForUser(context, 0),
  ) ?? context?.versions?.[0];
  const relationships: TableRelationship[] = [
    ...(context?.fullRelationships ?? []),
    ...(liveVersion?.relationships ?? []),
  ].filter((r) => r.connection === connection);

  return { schema, whitelisted, namingSchemas: source.schemas ?? [], relationships };
}

export async function getScopedSemanticModels(
  user: EffectiveUser,
  { path, connection, tables }: ScopedModelsParams,
): Promise<SemanticModel[]> {
  if (tables.length === 0) return [];

  const scope = await resolveScope(user, path, connection);
  if (!scope) return [];
  const { schema, whitelisted, namingSchemas, relationships } = scope;

  // Requested tables (∩ whitelist) plus their relationship targets (∩ whitelist)
  // — targets contribute join dimensions without getting models of their own.
  const requested = new Set<string>();
  for (const s of schema.schemas ?? []) {
    for (const t of s.tables ?? []) {
      if (tables.includes(t.table) && whitelisted.has(`${s.schema}|${t.table}`)) {
        requested.add(`${s.schema}|${t.table}`);
      }
    }
  }
  const inScope = new Set(requested);
  for (const r of relationships) {
    if (requested.has(`${r.schema ?? ''}|${r.table}`)) {
      const target = `${r.targetSchema ?? ''}|${r.targetTable}`;
      if (whitelisted.has(target)) inScope.add(target);
    }
  }
  if (requested.size === 0) return [];

  const scoped: DatabaseWithSchema = {
    databaseName: connection,
    schemas: (schema.schemas ?? [])
      .map((s) => ({ ...s, tables: (s.tables ?? []).filter((t) => inScope.has(`${s.schema}|${t.table}`)) }))
      .filter((s) => s.tables.length > 0),
  };
  // Global naming scope: all whitelisted tables (names-only is fine).
  const naming: DatabaseWithSchema = { databaseName: connection, schemas: namingSchemas };

  return deriveSemanticModels([scoped], relationships, [naming])
    .filter((m) => requested.has(`${m.schema ?? ''}|${m.table}`));
}

// ---------------------------------------------------------------------------
// Metrics-first search — find measures/dimensions across the WHOLE whitelist
// ---------------------------------------------------------------------------

export interface SemanticFieldHit {
  kind: 'measure' | 'dimension';
  name: string;
  model: string;
  connection: string;
  schema?: string;
  table: string;
}

// Deriving every whitelisted table's vocabulary is CPU work proportional to the
// schema, and search fires per keystroke — cache the flattened field list
// briefly per (mode, connection, schema freshness). 30s staleness after a
// whitelist/relationship edit is acceptable for a typeahead.
// eslint-disable-next-line no-restricted-syntax -- server-side per-process typeahead cache; entries expire in 30s
const fieldCache = new Map<string, { at: number; fields: SemanticFieldHit[] }>();
const FIELD_CACHE_TTL_MS = 30_000;

export async function searchSemanticFields(
  user: EffectiveUser,
  { path, connection, q, limit = 50 }: { path: string; connection: string; q: string; limit?: number },
): Promise<SemanticFieldHit[]> {
  const scope = await resolveScope(user, path, connection);
  if (!scope) return [];

  const cacheKey = `${user.mode}|${connection}|${scope.schema.updated_at}|${scope.whitelisted.size}|${JSON.stringify(scope.relationships)}`;
  let entry = fieldCache.get(cacheKey);
  if (!entry || Date.now() - entry.at > FIELD_CACHE_TTL_MS) {
    const all: DatabaseWithSchema = {
      databaseName: connection,
      schemas: (scope.schema.schemas ?? [])
        .map((s) => ({ ...s, tables: (s.tables ?? []).filter((t) => scope.whitelisted.has(`${s.schema}|${t.table}`)) }))
        .filter((s) => s.tables.length > 0),
    };
    const models = deriveSemanticModels([all], scope.relationships);
    const fields: SemanticFieldHit[] = [];
    for (const m of models) {
      for (const me of m.measures) {
        fields.push({ kind: 'measure', name: me.name, model: m.name, connection, schema: m.schema, table: m.table });
      }
      for (const d of m.dimensions) {
        fields.push({ kind: 'dimension', name: d.name, model: m.name, connection, schema: m.schema, table: m.table });
      }
    }
    entry = { at: Date.now(), fields };
    fieldCache.set(cacheKey, entry);
    if (fieldCache.size > 8) fieldCache.delete(fieldCache.keys().next().value!); // tiny LRU-ish bound
  }

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = tokens.length === 0
    ? entry.fields
    : entry.fields.filter((f) => {
        const hay = `${f.name} ${f.model}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
  return matches.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Server-side detection — parse → scope models to the SQL's tables → detect
// ---------------------------------------------------------------------------

/**
 * The same reliability-gated detection the question page runs client-side
 * (parse to IR, fetch models scoped to the tables the SQL touches, recompile-
 * verify), in one server call. Returns the spec or null.
 */
export async function detectSemanticSql(
  user: EffectiveUser,
  { path, connection, sql }: { path: string; connection: string; sql: string },
): Promise<import('@/lib/validation/atlas-schemas').SemanticQuerySpec | null> {
  if (!sql.trim()) return null;
  let dialect = 'duckdb';
  try {
    const conn = await ConnectionsAPI.getRawByName(connection, user.mode);
    dialect = connectionTypeToDialect(conn.type);
  } catch {
    return null;
  }
  // detectSemanticQuery parses first; give it models scoped to every table the
  // SQL names (parse once here to learn the tables).
  let tables: string[];
  try {
    const ir = await parseSqlToIrLocal(sql, dialect);
    if (!ir || (ir as { type?: string }).type === 'compound') return null;
    const simple = ir as import('@/lib/sql/ir-types').QueryIR;
    tables = [simple.from?.table, ...(simple.joins ?? []).map((j) => j.table?.table)]
      .filter((t): t is string => !!t);
  } catch {
    return null;
  }
  if (tables.length === 0) return null;
  const models = await getScopedSemanticModels(user, { path, connection, tables });
  if (models.length === 0) return null;
  return detectSemanticQuery(sql, models, dialect);
}
