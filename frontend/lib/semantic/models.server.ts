/**
 * AUTHORED semantic models, served scoped to a path (Semantic_Model_v2.md
 * §2.7 M5). Models are authored on context versions
 * (`ContextVersion.semanticModels`) and inherited down the context tree as
 * `content.fullSemanticModels` — resolution mirrors views
 * (lib/views/views.server.ts): nearest context for the path, inherited models
 * plus the user-visible published version's own. Served by
 * POST /api/semantic-models.
 *
 * Derivation (lib/semantic/derive.ts) no longer feeds these entry points — it
 * survives only as the draft-suggestion engine ("create a semantic model from
 * this table" pre-fills a draft).
 */
import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { findNearestContextPath, getPublishedVersionForUser } from '@/lib/context/context-utils';
import { resolvePath } from '@/lib/mode/path-resolver';
import { detectSemanticQuery } from '@/lib/semantic/detect-sql';
import { connectionTypeToDialect, VIEWS_SCHEMA } from '@/lib/types';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, SemanticModelV2 } from '@/lib/types';

export interface ScopedModelsParams {
  /** Folder the requesting file lives in (context resolution anchor), e.g. "/org". */
  path: string;
  /** Connection (database) name. */
  connection: string;
  /**
   * Optional primary scoping: only models whose primary (table name for
   * table-primaries, view name for model-primaries) is listed. Omit for ALL
   * authored models on the connection.
   */
  tables?: string[];
}

/** Load the nearest context (by serving folder) for `basePath` — the same resolution chat uses. */
export async function loadNearestContext(user: EffectiveUser, basePath: string): Promise<ContextContent | null> {
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

/**
 * Everything a context exposes: inherited (fullSemanticModels, computed by the
 * loader) + the user-visible published version's own — mirrors
 * resolveViewsForContext.
 */
export function resolveModelsForContext(content: ContextContent | null, userId: number): SemanticModelV2[] {
  if (!content) return [];
  const version = content.versions?.find(
    (v) => v.version === getPublishedVersionForUser(content, userId),
  ) ?? content.versions?.[0];
  return [...(content.fullSemanticModels ?? []), ...(version?.semanticModels ?? [])];
}

/** The name a model's primary is scoped/searched by (table name, or view name). */
const primaryName = (m: SemanticModelV2): string =>
  m.primary.kind === 'table' ? m.primary.table : m.primary.view;

/** Authored models visible at `path`, on one connection. */
async function authoredModelsForPath(
  user: EffectiveUser,
  path: string,
  connection: string,
): Promise<SemanticModelV2[]> {
  let context: ContextContent | null = null;
  try {
    context = await loadNearestContext(user, path);
  } catch {
    context = null; // no context / not readable → no authored models
  }
  return resolveModelsForContext(context, user.userId).filter((m) => m.connection === connection);
}

export async function getScopedSemanticModels(
  user: EffectiveUser,
  { path, connection, tables }: ScopedModelsParams,
): Promise<SemanticModelV2[]> {
  const models = await authoredModelsForPath(user, path, connection);
  if (tables === undefined) return models;
  return models.filter((m) => tables.includes(primaryName(m)));
}

// ---------------------------------------------------------------------------
// Metrics-first search — find measures/dimensions across every authored model
// ---------------------------------------------------------------------------

export interface SemanticFieldHit {
  kind: 'measure' | 'dimension';
  name: string;
  model: string;
  connection: string;
  schema?: string;
  table: string;
}

export async function searchSemanticFields(
  user: EffectiveUser,
  { path, connection, q, limit = 50 }: { path: string; connection: string; q: string; limit?: number },
): Promise<SemanticFieldHit[]> {
  const models = await authoredModelsForPath(user, path, connection);

  const fields: SemanticFieldHit[] = [];
  for (const m of models) {
    const table = primaryName(m);
    // Model-primaries are queried as _views.<name> — surface them there.
    const schema = m.primary.kind === 'table' ? (m.primary.schema ?? undefined) : VIEWS_SCHEMA;
    for (const me of m.measures) {
      fields.push({ kind: 'measure', name: me.name, model: m.name, connection, schema, table });
    }
    for (const d of m.dimensions) {
      fields.push({ kind: 'dimension', name: d.name, model: m.name, connection, schema, table });
    }
  }

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = tokens.length === 0
    ? fields
    : fields.filter((f) => {
        const hay = `${f.name} ${f.model}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
  return matches.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Server-side detection — authored models only
// ---------------------------------------------------------------------------

/**
 * The same reliability-gated detection the question page runs client-side
 * (parse to IR, match against the models visible at the path, recompile-
 * verify), in one server call. Detects against AUTHORED models only — with no
 * authored models the Semantic tab simply doesn't light up. Returns the spec
 * or null.
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
  const models = await getScopedSemanticModels(user, { path, connection });
  if (models.length === 0) return null;
  return detectSemanticQuery(sql, models, dialect);
}
