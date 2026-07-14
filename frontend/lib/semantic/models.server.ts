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
import { findNearestContextPath } from '@/lib/context/context-utils';
import { resolvePath } from '@/lib/mode/path-resolver';
import { deriveSemanticModels } from '@/lib/semantic/derive';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, DatabaseWithSchema, SemanticModel, TableRelationship } from '@/lib/types';

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

export async function getScopedSemanticModels(
  user: EffectiveUser,
  { path, connection, tables }: ScopedModelsParams,
): Promise<SemanticModel[]> {
  if (tables.length === 0) return [];

  const schema = await getPersistedConnectionSchema(connection, user);
  if (!schema) return [];

  let context: ContextContent | null = null;
  try {
    context = await loadNearestContext(user, path);
  } catch {
    context = null; // no context → scope to the connection schema directly
  }

  // Whitelisted table names for this connection (names survive bounding).
  // Without a context, every table in the connection is in scope.
  const contextDb = context?.fullSchema?.find((db) => db.databaseName === connection);
  const whitelisted = new Set<string>();
  const source = contextDb ?? { databaseName: connection, schemas: schema.schemas };
  for (const s of source.schemas ?? []) {
    for (const t of s.tables ?? []) whitelisted.add(`${s.schema}|${t.table}`);
  }

  const relationships: TableRelationship[] = (context?.fullRelationships ?? [])
    .filter((r) => r.connection === connection);

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
  const naming: DatabaseWithSchema = { databaseName: connection, schemas: source.schemas ?? [] };

  return deriveSemanticModels([scoped], relationships, [naming])
    .filter((m) => requested.has(`${m.schema ?? ''}|${m.table}`));
}
