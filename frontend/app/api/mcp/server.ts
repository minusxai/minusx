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
import { DocumentDB } from '@/lib/database/documents-db';
import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import { ConnectionContent } from '@/lib/types';
import { resolvePath } from '@/lib/mode/path-resolver';
import { searchDatabaseSchema } from '@/lib/search/schema-search';
import { executeQuery as execQuery } from '@/lib/api/execute-query.server';
import { getNodeConnector } from '@/lib/connections';
import { compressQueryResult } from '@/lib/api/file-state';

/**
 * Create an MCP server instance bound to a specific user.
 * Each MCP session gets its own server so tool handlers have access
 * to the user's connections, contexts, and permissions.
 */
export function createMcpServer(user: EffectiveUser): McpServer {
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
    async ({ connection_id, query }) => {
      const connectionPath = resolvePath(user.mode, `/database/${connection_id}`);
      const connectionFile = await DocumentDB.getByPath(connectionPath, user.companyId);

      if (!connectionFile) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Connection '${connection_id}' not found` }) }],
        };
      }

      const loadedConnection = await connectionLoader(connectionFile, user);
      const content = loadedConnection.content as ConnectionContent;
      const schemaData = content.schema || { schemas: [], updated_at: new Date().toISOString() };

      const result = await searchDatabaseSchema(schemaData.schemas, query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
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
    async ({ query, connection_id, parameters }) => {
      const params: Record<string, string | number> = parameters || {};

      // Try Node.js connector first (DuckDB) to avoid Python's exclusive file lock
      const connPath = resolvePath(user.mode, `/database/${connection_id}`);
      const connFile = await DocumentDB.getByPath(connPath, user.companyId);

      if (connFile?.content) {
        const { type, config } = connFile.content as ConnectionContent;
        const connector = getNodeConnector(connection_id, type, config);
        if (connector) {
          const result = await connector.query(query, params);
          const compressed = compressQueryResult(result);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ success: true, data: compressed }) }],
          };
        }
      }

      // Fall through to Python backend for postgresql, bigquery, etc.
      const result = await execQuery({
        query,
        connectionId: connection_id,
        parameters: params,
      }, user);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.content) }],
      };
    }
  );

  return server;
}
