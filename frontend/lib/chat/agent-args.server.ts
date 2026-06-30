/**
 * Shared server-side agent_args builder.
 *
 * Loads connection, schema, and context documentation from the DB using the
 * same pure functions (getWhitelistedSchemaForUser, resolveContextDocs)
 * that the client-side AnalystAgent uses on the explore page and file page.
 *
 * Used by all server-initiated agent conversations (Slack, reports, evals,
 * alerts) so they all receive the same schema/context the client would derive
 * from the same DB state.
 */
import 'server-only';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { listAllConnections, getPersistedConnectionSchema } from '@/lib/data/connections.server';
import { findNearestContextPath } from '@/lib/context/context-utils';
import { resolveHomeFolderSync, resolvePath } from '@/lib/mode/path-resolver';
import { resolveContextDocs, getWhitelistedSchemaForUser } from '@/lib/sql/schema-filter';
import { connectionTypeToDialect } from '@/lib/utils/connection-dialect';
import { selectDatabase } from '@/lib/utils/database-selector';
import type { ContextContent, DatabaseWithSchema, ResolvedContextDocs, TableAnnotation } from '@/lib/types';

export interface ServerAgentArgs {
  connection_id?: string;
  selected_database_info?: { name: string; dialect: string };
  schema: Array<{ schema: string; tables: string[] }>;
  /**
   * Resolved context docs (STRUCTURE) — one list tagged alwaysInclude, plus schema
   * notes. Carried as-is to the agent, which renders the prompt's Context section
   * and feeds the LoadContext tool from it (via formatContextDocsSection). Replaces
   * the old separate inline-string + catalog representations.
   */
  context_docs: ResolvedContextDocs;
  /**
   * Context-authored table/column annotations (the editorial layer, from the
   * context's `fullAnnotations`). Carried to the agent context so SearchDBSchema
   * can merge them into its catalog's `annotation` columns — the prompt's Schema
   * Notes section is char-budgeted, so this is how the agent recovers the rest.
   */
  annotations?: TableAnnotation[];
}

function flattenSchemaForPrompt(
  fullSchema: DatabaseWithSchema[] | undefined,
  databaseName: string
): Array<{ schema: string; tables: string[] }> {
  const selected = fullSchema?.find((entry) => entry.databaseName === databaseName) ?? fullSchema?.[0];
  if (!selected) return [];
  return selected.schemas.map((s) => ({
    schema: s.schema,
    tables: s.tables.map((t) => t.table),
  }));
}

export interface BuildServerAgentArgsOptions {
  /**
   * When provided, load this specific context file for schema/docs instead of
   * resolving the nearest ancestor context for the user's home folder.
   *
   * Use case: context eval jobs — the TestAgent should receive the schema and
   * documentation from the context file being evaluated, not from whatever
   * context happens to be nearest to the cron user's home folder.
   */
  contextFileId?: number;
  /**
   * Resolve this specific context version's docs + whitelist instead of the
   * user's published version. The interactive chat path forwards the client's
   * `context_version` (admin version-testing) so the server resolves exactly the
   * context the user is looking at in the UI.
   */
  contextVersion?: number;
  /**
   * The connection the user selected in the UI. The server computes the schema
   * for this database (and reports it as the active connection) instead of
   * picking the context's first whitelisted database.
   */
  connectionId?: string;
}

/**
 * Build the base agent_args fields shared by all server-initiated conversations.
 *
 * Resolves connection, whitelisted schema, and context documentation for the
 * user by loading from the DB — the same data the client sends when starting
 * a chat from the explore page or file page.
 *
 * @param options.contextFileId — override: load this specific context file
 *   instead of resolving the nearest ancestor. Used by context eval jobs so
 *   the TestAgent receives the evaluated context's own schema/docs.
 */
export async function buildServerAgentArgs(
  user: EffectiveUser,
  options?: BuildServerAgentArgsOptions
): Promise<ServerAgentArgs> {
  const { connections } = await listAllConnections(user, false);

  // Load context first so we can prefer the connection the context whitelists —
  // this mirrors exactly what the client's AnalystAgent does (selectDatabase on
  // the context's whitelisted databases, not on all connections).
  let databases: DatabaseWithSchema[] | undefined;
  let resolvedDocs: ResolvedContextDocs = { docs: [] };
  let annotations: TableAnnotation[] | undefined;

  try {
    const effectiveHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
    let contextContent: ContextContent | undefined;

    if (options?.contextFileId != null) {
      // Context eval path: use the specific context file being evaluated.
      const contextResult = await FilesAPI.loadFile(options.contextFileId, user);
      contextContent = contextResult.data?.content as ContextContent | undefined;
    } else {
      // General path: find the context file nearest to the user's home folder.
      const modePath = resolvePath(user.mode, '/');
      const { data: contextFiles } = await FilesAPI.getFiles(
        { type: 'context', paths: [modePath], depth: -1 },
        user
      );
      const nearestContextPath = findNearestContextPath(
        contextFiles.map((f) => f.path),
        effectiveHomeFolder
      );
      if (nearestContextPath) {
        const contextResult = await FilesAPI.loadFileByPath(nearestContextPath, user);
        contextContent = contextResult.data.content as ContextContent;
      }
    }

    if (contextContent) {
      databases = getWhitelistedSchemaForUser(contextContent, user.userId, options?.contextVersion);
      resolvedDocs = resolveContextDocs(contextContent, user.userId, options?.contextVersion);
      annotations = contextContent.fullAnnotations;
    }
  } catch {
    // Proceed without context — agent can still use SearchDBSchema tool
  }

  // Pick a default connection ONLY when there's an unambiguous single target:
  //  1. the UI explicitly selected one (interactive chat), or
  //  2. exactly one connection is available to this context.
  // When MULTIPLE connections are available and none was selected (Slack / remote / MCP / cron),
  // DO NOT silently lock to the first — leave the connection unset so the agent PICKS the right one
  // per query (it has ListDBConnections + a per-tool `connection_id`/`connectionId`). Forcing the
  // first connection sent every Slack query to the wrong database.
  const whitelistedNames = (databases ?? []).map((d) => d.databaseName).filter(Boolean);
  const candidateNames = whitelistedNames.length > 0 ? whitelistedNames : connections.map((c) => c.name);

  let selectedConnection: (typeof connections)[number] | undefined;
  if (options?.connectionId) {
    const name = selectDatabase(connections, options.connectionId);
    selectedConnection = connections.find((c) => c.name === name);
  } else if (candidateNames.length === 1) {
    const name = selectDatabase(connections, candidateNames[0]);
    selectedConnection = connections.find((c) => c.name === name);
  }
  // else: multiple connections, no selection → leave undefined so the agent chooses.

  const selectedDatabaseName = selectedConnection?.name || '';

  // Prompt schema: only when a single connection is resolved. With no default connection the agent
  // discovers schema on demand via ListDBConnections + SearchDBSchema for the connection it picks.
  // Prefer the context's whitelisted schema for the selected DB; fall back to the connection's own
  // persisted schema when the context whitelists nothing yet (e.g. onboarding).
  let schema: Array<{ schema: string; tables: string[] }> = [];
  if (selectedConnection) {
    schema = flattenSchemaForPrompt(databases, selectedDatabaseName);
    if (schema.length === 0 && selectedConnection.name) {
      const persisted = await getPersistedConnectionSchema(selectedConnection.name, user);
      if (persisted) {
        schema = persisted.schemas.map((s) => ({
          schema: s.schema,
          tables: s.tables.map((t) => t.table),
        }));
      }
    }
  }

  return {
    connection_id: selectedConnection?.name,
    selected_database_info: selectedDatabaseName
      ? {
          name: selectedDatabaseName,
          dialect: connectionTypeToDialect(selectedConnection?.type || 'postgresql'),
        }
      : undefined,
    schema,
    context_docs: resolvedDocs,
    annotations,
  };
}
