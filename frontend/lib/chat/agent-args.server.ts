/**
 * Shared server-side agent_args builder.
 *
 * Loads connection, schema, and context documentation from the DB using the
 * same pure functions (getWhitelistedSchemaForUser, getDocumentationForUser)
 * that the client-side AnalystAgent uses on the explore page and file page.
 *
 * Used by all server-initiated agent conversations (Slack, reports, evals,
 * alerts) so they all receive the same schema/context the client would derive
 * from the same DB state.
 */
import 'server-only';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { listAllConnections } from '@/lib/data/connections.server';
import { findNearestContextPath } from '@/lib/context/context-utils';
import { resolveHomeFolderSync, resolvePath } from '@/lib/mode/path-resolver';
import { getDocumentationForUser, getWhitelistedSchemaForUser } from '@/lib/sql/schema-filter';
import { connectionTypeToDialect } from '@/lib/utils/connection-dialect';
import { selectDatabase } from '@/lib/utils/database-selector';
import type { ContextContent, DatabaseWithSchema } from '@/lib/types';

export interface ServerAgentArgs {
  connection_id?: string;
  selected_database_info?: { name: string; dialect: string };
  schema: Array<{ schema: string; tables: string[] }>;
  context: string;
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
  let documentation: string | undefined;

  try {
    const effectiveHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
    let contextContent: ContextContent | undefined;
    let nearestContextDir: string | undefined;

    if (options?.contextFileId != null) {
      // Context eval path: use the specific context file being evaluated.
      const contextResult = await FilesAPI.loadFile(options.contextFileId, user);
      contextContent = contextResult.data?.content as ContextContent | undefined;
      const contextPath = contextResult.data?.path;
      if (contextPath) {
        nearestContextDir = contextPath.substring(0, contextPath.lastIndexOf('/')) || '/';
      }
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
        nearestContextDir = nearestContextPath.substring(0, nearestContextPath.lastIndexOf('/')) || '/';
      }
    }

    if (contextContent) {
      databases = getWhitelistedSchemaForUser(contextContent, user.userId, effectiveHomeFolder, nearestContextDir);
      documentation = getDocumentationForUser(contextContent, user.userId);
    }
  } catch {
    // Proceed without context — agent can still use SearchDBSchema tool
  }

  // Prefer the first database whitelisted by the context (mirrors client selectDatabase
  // behavior). Fall back to the first available connection if no context is present.
  const contextPreferred = databases?.[0]?.databaseName ?? null;
  const selectedConnectionName = selectDatabase(connections, contextPreferred);
  const selectedConnection = connections.find((c) => c.name === selectedConnectionName) ?? connections[0];

  const selectedDatabaseName = selectedConnection?.name || '';

  return {
    connection_id: selectedConnection?.name,
    selected_database_info: selectedDatabaseName
      ? {
          name: selectedDatabaseName,
          dialect: connectionTypeToDialect(selectedConnection?.type || 'postgresql'),
        }
      : undefined,
    schema: flattenSchemaForPrompt(databases, selectedDatabaseName),
    context: documentation ?? '',
  };
}
