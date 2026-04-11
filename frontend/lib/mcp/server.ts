/**
 * MCP Server Factory
 *
 * Creates a per-session McpServer instance that closes over the authenticated
 * EffectiveUser. Registers tools for schema search, query execution, file
 * search, and file reading, reusing existing handler logic.
 */

import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import { ConnectionContent } from '@/lib/types';
import type { FileType } from '@/lib/ui/file-metadata';
import { resolvePath } from '@/lib/mode/path-resolver';
import { searchDatabaseSchema } from '@/lib/search/schema-search';
import { executeQuery as execQuery } from '@/lib/api/execute-query.server';
import { getNodeConnector } from '@/lib/connections';
import { compressQueryResult } from '@/lib/api/compress-augmented';
import { searchFilesInFolder } from '@/lib/search/file-search';
import { readFilesServer } from '@/lib/api/file-state.server';

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
  const server = new McpServer(
    {
      name: 'minusx',
      version: '1.0.0',
    },
    {
      instructions: [
        'MinusX is a an agentic BI tool with questions (SQL queries + visualizations) and dashboards (collections of questions).',
        '',
        'URL patterns:',
        '- Files (questions, dashboards, etc.): /f/{id}  (e.g. /f/189)',
        '- Folders: /folder/{path}  (e.g. /folder/org/revenue)',
        '- Explore (ad-hoc SQL): /explore',
        '',
        'Files are identified by integer IDs. The `path` field (e.g. /org/elo-by-organization) is for display only.',
        'Use SearchFiles to find files by name/content, then ReadFiles to get full details.',
        'Use ListAllConnections to discover available databases, then SearchDBSchema and ExecuteQuery to work with data.',
        'As of now, you cannot create / modify files in the BI tool via MCP, only read/search existing ones. Future versions may add write capabilities.',
      ].join('\n'),
    }
  );

  // -----------------------------------------------------------------------
  // SearchDBSchema
  // -----------------------------------------------------------------------
  server.registerTool(
    'SearchDBSchema',
    {
      description: 'Search database schema for tables, columns, and relationships. Use string search for keywords, or JSONPath (starting with $) for structured queries.',
      inputSchema: {
        connection_id: z.string().describe('Database connection ID'),
        query: z.string().optional().describe('Search query (string) or JSONPath expression (starting with $). Omit for full schema.'),
      },
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
  server.registerTool(
    'ExecuteQuery',
    {
      description: 'Execute a SQL query against a database connection. Returns columns, types, and rows.',
      inputSchema: {
        query: z.string().describe('SQL query to execute'),
        connection_id: z.string().describe('Database connection ID'),
        parameters: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('Query parameters (e.g., { "limit": 10 })'),
      },
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

  // -----------------------------------------------------------------------
  // ListAllConnections
  // -----------------------------------------------------------------------
  server.registerTool(
    'ListAllConnections',
    {
      description: 'List all available database connections with their names and types.',
    },
    async () => {
      const { connections } = await ConnectionsAPI.listAll(user);
      const result: McpToolCallResult = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              connections.map(({ name, type }) => ({ name, type }))
            ),
          },
        ],
      };
      onToolCall?.('ListAllConnections', {}, result);
      return result;
    }
  );

  // -----------------------------------------------------------------------
  // SearchFiles
  // -----------------------------------------------------------------------
  server.registerTool(
    'SearchFiles',
    {
      description: 'Search files (questions, dashboards) by name, description, or content. Returns ranked results with match snippets.',
      inputSchema: {
        query: z.string().describe('Search term to find in file names, descriptions, and content'),
        file_types: z.array(z.string()).optional().describe("File types to search: 'question', 'dashboard'. Default: both"),
        folder_path: z.string().optional().describe("Folder path to search within (default: user's home folder)"),
        limit: z.number().optional().describe('Maximum number of results to return (default: 20)'),
        offset: z.number().optional().describe('Number of results to skip for pagination (default: 0)'),
      },
    },
    async ({ query, file_types, folder_path, limit, offset }: {
      query: string;
      file_types?: string[];
      folder_path?: string;
      limit?: number;
      offset?: number;
    }) => {
      const searchResult = await searchFilesInFolder(
        {
          query,
          file_types: file_types as FileType[] | undefined,
          folder_path,
          depth: 999,
          limit: limit ?? 20,
          offset: offset ?? 0,
          visibility: 'all',
        },
        user
      );

      const result: McpToolCallResult = {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, ...searchResult }) }],
      };
      onToolCall?.('SearchFiles', { query, file_types, folder_path, limit, offset }, result);
      return result;
    }
  );

  // -----------------------------------------------------------------------
  // ReadFiles
  // -----------------------------------------------------------------------
  server.registerTool(
    'ReadFiles',
    {
      description: 'Load one or more files by ID with their full content. Returns complete JSON including name, path, type, and content.',
      inputSchema: {
        fileIds: z.array(z.number()).describe('Array of file IDs to load'),
      },
    },
    async ({ fileIds }: { fileIds: number[] }) => {
      // Use readFilesServer for consistent behavior with client-side:
      // - Includes references with parameter inheritance
      // - Computes effective queryResultIds
      const files = await readFilesServer(fileIds, user, { executeQueries: false });

      const result: McpToolCallResult = {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, files }) }],
      };
      onToolCall?.('ReadFiles', { fileIds }, result);
      return result;
    }
  );

  return server;
}
