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

function flattenSchemaForPrompt(fullSchema: DatabaseWithSchema[] | undefined, databaseName: string): Array<{ schema: string; tables: string[] }> {
  const selected = fullSchema?.find((entry) => entry.databaseName === databaseName) ?? fullSchema?.[0];
  if (!selected) {
    return [];
  }

  return selected.schemas.map((schema) => ({
    schema: schema.schema,
    tables: schema.tables.map((table) => table.table),
  }));
}

export async function buildSlackAgentArgs(user: EffectiveUser): Promise<{
  connection_id?: string;
  selected_database_info?: { name: string; dialect: string };
  schema?: Array<{ schema: string; tables: string[] }>;
  context?: string;
  app_state: { type: 'slack' };
}> {
  const { connections } = await listAllConnections(user, false);
  const selectedConnectionName = selectDatabase(connections, null);
  const selectedConnection = connections.find((connection) => connection.name === selectedConnectionName) ?? connections[0];

  let databases: DatabaseWithSchema[] | undefined;
  let documentation: string | undefined;

  try {
    const modePath = resolvePath(user.mode, '/');
    const effectiveHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
    const { data: contextFiles } = await FilesAPI.getFiles({ type: 'context', paths: [modePath], depth: -1 }, user);
    const nearestContextPath = findNearestContextPath(
      contextFiles.map((file) => file.path),
      effectiveHomeFolder,
    );

    if (nearestContextPath) {
      const contextResult = await FilesAPI.loadFileByPath(nearestContextPath, user);
      const context = contextResult.data.content as ContextContent;
      databases = getWhitelistedSchemaForUser(context, user.userId, effectiveHomeFolder);
      documentation = getDocumentationForUser(context, user.userId);
    }
  } catch (error) {
    console.warn('[Slack context] Failed to load effective context, proceeding without context file');
  }

  const selectedDatabaseName = selectedConnection?.name || (databases ? selectDatabase(databases, null) : '');

  return {
    connection_id: selectedConnection?.name,
    selected_database_info: selectedDatabaseName
      ? {
          name: selectedDatabaseName,
          dialect: connectionTypeToDialect(selectedConnection?.type || 'postgresql'),
        }
      : undefined,
    schema: flattenSchemaForPrompt(databases, selectedDatabaseName),
    context: documentation,
    app_state: { type: 'slack' },
  };
}
