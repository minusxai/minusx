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

/**
 * Build the base agent_args fields shared by all server-initiated conversations.
 *
 * Resolves connection, whitelisted schema, and context documentation for the
 * user by loading from the DB — the same data the client sends when starting
 * a chat from the explore page or file page.
 */
export async function buildServerAgentArgs(user: EffectiveUser): Promise<ServerAgentArgs> {
  const { connections } = await listAllConnections(user, false);
  const selectedConnectionName = selectDatabase(connections, null);
  const selectedConnection = connections.find((c) => c.name === selectedConnectionName) ?? connections[0];

  let databases: DatabaseWithSchema[] | undefined;
  let documentation: string | undefined;

  try {
    const modePath = resolvePath(user.mode, '/');
    const effectiveHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
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
      const context = contextResult.data.content as ContextContent;
      databases = getWhitelistedSchemaForUser(context, user.userId, effectiveHomeFolder);
      documentation = getDocumentationForUser(context, user.userId);
    }
  } catch {
    // Proceed without context — agent can still use SearchDBSchema tool
  }

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
