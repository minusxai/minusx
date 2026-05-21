import 'server-only';
import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import { ConnectionContent } from '@/lib/types';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { getNodeConnector } from '@/lib/connections';
import { fuzzyMatch } from '@/lib/connections/fuzzy-search';

/** Args for the FuzzyMatch tool — mirrors Python's FuzzyMatch (tools.py). */
export interface FuzzyMatchToolArgs {
  connection_id: string;
  table: string;
  column: string;
  search_term: string;
  schema?: string;
  limit?: number;
  return_columns?: string[];
  // semantic_expansion is accepted (schema parity with Python) but not used —
  // matching the v1 handler, which calls fuzzyMatch() once.
  semantic_expansion?: boolean;
}

/**
 * Resolve a connection, validate the target column is text/categorical, and run
 * a single fuzzy match. Shared by the v1 Next.js tool handler and the v2
 * production FuzzyMatch tool so both behave identically (matching Python chat).
 */
export async function executeFuzzyMatch(
  args: FuzzyMatchToolArgs,
  user: EffectiveUser,
): Promise<Record<string, unknown>> {
  const { connection_id, table, column, search_term, schema: schemaName, limit, return_columns } = args;

  if (!connection_id || !table || !column || !search_term) {
    throw new Error('connection_id, table, column, and search_term are required');
  }

  // Load connection with cached schema (same path as SearchDBSchema)
  const connectionPath = resolvePath(user.mode, `/database/${connection_id}`);
  const connectionFile = await FilesAPI.loadFileByPath(connectionPath, user);
  const loadedConnection = await connectionLoader(connectionFile.data, user);
  const content = loadedConnection.content as ConnectionContent;

  // Validate column category — FuzzyMatch only works on text/categorical columns
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schemaData = (content.schema?.schemas ?? []) as any[];
  const targetSchema = schemaData.find((s) => (schemaName ? s.schema === schemaName : true));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetTable = targetSchema?.tables?.find((t: any) => t.table === table);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetColumn = targetTable?.columns?.find((c: any) => c.name === column);
  const category = targetColumn?.meta?.category as string | undefined;

  if (category && category !== 'text' && category !== 'categorical') {
    return {
      success: false,
      error: `FuzzyMatch is only for text or categorical columns. Column "${column}" has category "${category}". Use exact filters (=, >, <, BETWEEN) for ${category} columns instead.`,
    };
  }

  const connector = getNodeConnector(connection_id, content.type, content.config);
  if (!connector) {
    throw new Error(`No connector available for type: ${content.type}`);
  }

  const queryFn = (sql: string) => connector.query(sql);
  const result = await fuzzyMatch(content.type, queryFn, {
    table,
    columns: [column],
    searchTerm: search_term,
    schema: schemaName,
    limit,
    returnColumns: return_columns ?? [],
  });

  return { success: true, ...result };
}
