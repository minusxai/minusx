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
import { ConnectionContent, type ResolvedContextDocs } from '@/lib/types';
import type { FileType } from '@/lib/ui/file-metadata';
import { resolvePath } from '@/lib/mode/path-resolver';
import { searchDatabaseSchema } from '@/lib/search/schema-search';
import { executeQuery as execQuery } from '@/lib/api/execute-query.server';
import { getNodeConnector } from '@/lib/connections';
import { compressQueryResult } from '@/lib/api/compress-augmented';
import { searchFilesInFolder } from '@/lib/search/file-search';
import { readFilesServer } from '@/lib/api/file-state.server';
import { getWhitelistForUser } from '@/lib/sql/whitelist-resolver.server';
import { validateQueryTables } from '@/lib/sql/validate-query-tables';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import { formatContextDocsSection, loadContextDocsByKeys } from '@/lib/sql/schema-filter';

export type McpToolCallResult = { content: Array<{ type: 'text'; text: string }> };
export type OnToolCall = (tool: string, args: Record<string, unknown>, result: McpToolCallResult) => void;

/**
 * Create an MCP server instance bound to a specific user.
 * Each MCP session gets its own server so tool handlers have access
 * to the user's connections, contexts, and permissions.
 *
 * Resolves the user's context (same path as Slack/reports via buildServerAgentArgs)
 * so the connecting client impersonates that user: the Default Context Docs +
 * Schema Notes are baked into the server `instructions`, and the on-demand Context
 * Library is exposed through the LoadContext tool (mirroring the in-app agent).
 *
 * @param onToolCall - Optional callback invoked after each tool completes (used for session logging).
 */
export async function createMcpServer(user: EffectiveUser, onToolCall?: OnToolCall): Promise<McpServer> {
  // Resolve the user's nearest context (docs + schema notes). Best-effort — MCP
  // still works without context (the data tools don't depend on it).
  let contextDocs: ResolvedContextDocs = { docs: [] };
  try {
    ({ context_docs: contextDocs } = await buildServerAgentArgs(user));
  } catch {
    // Proceed without context — the read/search tools still function.
  }
  const hasLoadableDocs = contextDocs.docs.some((d) => !d.alwaysInclude);

  const baseInstructions = [
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
  ].join('\n');

  // Append the user's context: Default Context Docs + Schema Notes inline, plus the
  // Context Library catalog advertising keys to fetch via LoadContext. Same shared
  // formatter the web prompt and docs sidebar use, so all three stay identical.
  const contextSection = formatContextDocsSection(contextDocs);
  const instructions = contextSection
    ? `${baseInstructions}\n\n## Context\n\n${contextSection}`
    : baseInstructions;

  const server = new McpServer(
    {
      name: 'minusx',
      version: '1.0.0',
    },
    { instructions }
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
      description: 'Execute a SQL query against a database connection. A default LIMIT of 1000 rows is applied when your query has no LIMIT clause; an explicit LIMIT above 10000 is capped at 10000. Use COUNT/SUM/GROUP BY for cardinality questions and explicit LIMIT/OFFSET to page through large tables. Returns columns, types, and rows.',
      inputSchema: {
        query: z.string().describe('SQL query to execute'),
        connection_id: z.string().describe('Database connection ID'),
        parameters: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('Query parameters (e.g., { "limit": 10 })'),
      },
    },
    async ({ query, connection_id, parameters }: { query: string; connection_id: string; parameters?: Record<string, string | number> }) => {
      const params: Record<string, string | number> = parameters || {};

      // Whitelist validation — use the user's home folder to find the relevant context
      const whitelist = await getWhitelistForUser(connection_id, user);
      if (whitelist) {
        const validationError = await validateQueryTables(query, whitelist, user);
        if (validationError) {
          const result: McpToolCallResult = {
            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: validationError }) }],
          };
          onToolCall?.('ExecuteQuery', { query, connection_id, parameters }, result);
          return result;
        }
      }

      // Resolve the connection and run via the Node.js connector.
      // Use getRawByName so credentials (e.g. service_account_json) are included
      const connData = await ConnectionsAPI.getRawByName(connection_id, user.mode).catch(() => null);
      if (connData) {
        const { type, config } = connData;
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

      // Fall through to the Node.js query executor for postgresql, bigquery, etc.
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

  // -----------------------------------------------------------------------
  // LoadContext — only when the user's context has on-demand (library) docs.
  // Pinned (alwaysInclude) docs are already inline in `instructions`, so a
  // context with nothing loadable doesn't get the tool at all.
  // -----------------------------------------------------------------------
  if (hasLoadableDocs) {
    server.registerTool(
      'LoadContext',
      {
        description:
          'Load the full content of one or more context documents by their key, as listed in the Context Library section of the instructions. ' +
          "Request only the specific docs relevant to the user's question — avoid loading everything at once.",
        inputSchema: {
          keys: z.array(z.string()).describe('Document keys from the Context Library to load full content for.'),
        },
      },
      async ({ keys }: { keys: string[] }) => {
        const { payload } = loadContextDocsByKeys(contextDocs, keys);
        const result: McpToolCallResult = {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        };
        onToolCall?.('LoadContext', { keys }, result);
        return result;
      }
    );
  }

  return server;
}
