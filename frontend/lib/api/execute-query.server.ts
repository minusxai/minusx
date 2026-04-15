/**
 * ExecuteQuery - Standalone query execution (backend tool)
 *
 * Phase 1: Unified File System API
 *
 * Executes SQL query and caches results.
 * Does NOT modify any files - pure query execution.
 */

import { ExecuteQueryInput, ExecuteQueryDetails, QueryResult } from '@/lib/types';
import { runQuery } from '@/lib/connections/run-query';
import { compressQueryResult, TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import type { ServerToolResult } from '@/app/api/chat/orchestrator';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/**
 * ExecuteQuery implementation
 *
 * @param input - Query, connection, and parameters
 * @param userOverride - Optional user for contexts without an HTTP session (e.g., MCP, cron jobs)
 * @returns Query result with columns, types, rows
 */
export async function executeQuery(
  input: ExecuteQueryInput & { maxChars?: number },
  userOverride?: EffectiveUser
): Promise<ServerToolResult> {
  const { query, connectionId, parameters = {}, maxChars: rawMaxChars } = input;
  const maxChars = Math.min(rawMaxChars ?? TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS);

  try {
    const result = await runQuery(connectionId, query, parameters as Record<string, string | number>, userOverride!);
    const compressed = compressQueryResult(result, maxChars);
    const details: ExecuteQueryDetails = { success: true, queryResult: result as QueryResult };
    return { content: compressed, details };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    const details: ExecuteQueryDetails = { success: false, error: errMsg };
    return { content: details, details };
  }
}
