/**
 * MCP Server Factory
 *
 * Creates a per-session McpServer instance that closes over the authenticated
 * EffectiveUser. Registers SearchDBSchema and ExecuteQuery tools, reusing
 * existing handler logic from tool-handlers.server.ts.
 */

import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import { ConnectionContent } from '@/lib/types';
import { resolvePath } from '@/lib/mode/path-resolver';
import { searchDatabaseSchema } from '@/lib/search/schema-search';
import { executeQuery as execQuery } from '@/lib/api/execute-query.server';
import { getNodeConnector } from '@/lib/connections';
import { compressQueryResult } from '@/lib/api/file-state';

export type McpToolCallResult = { content: Array<{ type: 'text'; text: string }> };
export type OnToolCall = (tool: string, args: Record<string, unknown>, result: McpToolCallResult) => void;

/**
 * Create an MCP server instance bound to a specific user.
 * Each MCP session gets its own server so tool handlers have access
 * to the user's connections, contexts, and permissions.
 *
 * @param onToolCall - Optional callback invoked after each tool completes (used for session logging).
 */
export function createMcpServer(user: EffectiveUser, onToolCall?: OnToolCall): McpServer {
  const server = new McpServer({
    name: 'minusx',
    version: '1.0.0',
  });

  // -----------------------------------------------------------------------
  // SearchDBSchema
  // -----------------------------------------------------------------------
  server.tool(
    'SearchDBSchema',
    'Search database schema for tables, columns, and relationships. Use string search for keywords, or JSONPath (starting with $) for structured queries.',
    {
      connection_id: z.string().describe('Database connection ID'),
      query: z.string().optional().describe('Search query (string) or JSONPath expression (starting with $). Omit for full schema.'),
    },
    async ({ connection_id, query }: { connection_id: string; query?: string }) => {
      const connectionPath = resolvePath(user.mode, `/database/${connection_id}`);
      const connectionFile = await FilesAPI.loadFileByPath(connectionPath, user).catch(() => null);

      if (!connectionFile) {
        const result: McpToolCallResult = {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Connection '${connection_id}' not found` }) }],
        };
        onToolCall?.('SearchDBSchema', { connection_id, query }, result);
        return result;
      }

      const loadedConnection = await connectionLoader(connectionFile.data, user);
      const content = loadedConnection.content as ConnectionContent;
      const schemaData = content.schema || { schemas: [], updated_at: new Date().toISOString() };

      const searchResult = await searchDatabaseSchema(schemaData.schemas, query);
      const result: McpToolCallResult = {
        content: [{ type: 'text' as const, text: JSON.stringify(searchResult) }],
      };
      onToolCall?.('SearchDBSchema', { connection_id, query }, result);
      return result;
    }
  );

  // -----------------------------------------------------------------------
  // ExecuteQuery
  // -----------------------------------------------------------------------
  server.tool(
    'ExecuteQuery',
    'Execute a SQL query against a database connection. Returns columns, types, and rows.',
    {
      query: z.string().describe('SQL query to execute'),
      connection_id: z.string().describe('Database connection ID'),
      parameters: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('Query parameters (e.g., { "limit": 10 })'),
    },
    async ({ query, connection_id, parameters }: { query: string; connection_id: string; parameters?: Record<string, string | number> }) => {
      const params: Record<string, string | number> = parameters || {};

      // Try Node.js connector first (DuckDB) to avoid Python's exclusive file lock
      const connData = await ConnectionsAPI.getByName(connection_id, user).catch(() => null);
      if (connData) {
        const { type, config } = connData.connection;
        const connector = getNodeConnector(connection_id, type, config);
        if (connector) {
          const queryResult = await connector.query(query, params);
          const compressed = compressQueryResult(queryResult);
          const result: McpToolCallResult = {
            content: [{ type: 'text' as const, text: JSON.stringify({ success: true, data: compressed }) }],
          };
          onToolCall?.('ExecuteQuery', { query, connection_id, parameters }, result);
          return result;
        }
      }

      // Fall through to Python backend for postgresql, bigquery, etc.
      const execResult = await execQuery({
        query,
        connectionId: connection_id,
        parameters: params,
      }, user);

      const result: McpToolCallResult = {
        content: [{ type: 'text' as const, text: JSON.stringify(execResult.content) }],
      };
      onToolCall?.('ExecuteQuery', { query, connection_id, parameters }, result);
      return result;
    }
  );

  return server;
}
