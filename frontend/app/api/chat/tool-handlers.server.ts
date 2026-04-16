/**
 * Next.js Backend Tool Handlers
 *
 * Tool implementations that register themselves with the orchestrator.
 * Each tool calls registerTool() to make itself available for execution.
 */

import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import { ConnectionContent } from '@/lib/types';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { FrontendToolException } from './frontend-tool-exception';
import { registerTool, registerToolFallback } from './orchestrator';
import { searchDatabaseSchema } from '@/lib/search/schema-search';
import { searchFilesInFolder } from '@/lib/search/file-search';
import { executeQuery as execQuery } from '@/lib/api/execute-query.server';
import { readFilesServer } from '@/lib/api/file-state.server';

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * UserInputToolBackend - a test tool that simulates backend execution
 */
registerTool('UserInputToolBackend', async () => {
  return 'Backend executed tool response';
});

/**
 * SearchDBSchema - Search database schema for tables and columns
 * Auto-detects: queries starting with '$' use JSONPath, others use weighted string search
 */
registerTool('SearchDBSchema', async (args, user) => {
  const { query, connection_id, _schema: whitelistedSchema } = args;

  if (!connection_id) {
    throw new Error('connection_id is required');
  }

  // Load connection file with cached schema (via loader)
  const connectionPath = resolvePath(user.mode, `/database/${connection_id}`);
  const connectionFile = await FilesAPI.loadFileByPath(connectionPath, user);

  // Apply connection loader to get schema (cached or fresh)
  const loadedConnection = await connectionLoader(connectionFile.data, user);
  const content = loadedConnection.content as ConnectionContent;
  const schemaData = content.schema || { schemas: [], updated_at: new Date().toISOString() };

  // If a whitelisted schema was injected, enforce it — even if empty.
  // Array.isArray check (not length > 0) so that [] (empty whitelist) returns nothing
  // rather than falling through to the full unfiltered schema.
  if (Array.isArray(whitelistedSchema)) {
    const filteredSchemas = schemaData.schemas.map((s: any) => {
      const allowed = whitelistedSchema.find((w: any) => w.schema === s.schema);
      if (!allowed) return null;
      return { ...s, tables: s.tables.filter((t: any) => allowed.tables.includes(t.table)) };
    }).filter(Boolean);
    return searchDatabaseSchema(filteredSchemas, query);
  }

  // No _schema injected (no active context) — return full schema
  return searchDatabaseSchema(schemaData.schemas, query);
});

/**
 * SearchFiles - Search files by content with ranking and snippets
 */
registerTool('SearchFiles', async (args, user) => {
  const {
    query,
    file_types,
    folder_path,
    depth = 999,
    limit = 20,
    offset = 0
  } = args;

  // Use the shared search function with 'all' visibility
  // LLMs should be able to search ALL accessible files, not just UI-visible ones
  const result = await searchFilesInFolder(
    {
      query,
      file_types,
      folder_path,
      depth,
      limit,
      offset,
      visibility: 'all'  // LLM search - no viewTypes filter
    },
    user
  );

  return {
    success: true,
    ...result
  };
});


/**
 * Clarify - Ask user for clarification with options
 * Supports single or multi-select responses
 */
registerTool('Clarify', async (args, _user, childResults) => {
  // Resume with child results (from frontend execution)
  if (childResults && childResults.length > 0) {
    const allChildren = childResults.flat();
    return allChildren[0].result;
  }

  // Spawn frontend tool for user input
  throw new FrontendToolException({
    spawnedTools: [{
      type: 'function',
      function: {
        name: 'ClarifyFrontend',
        arguments: args
      }
    }]
  });
});

// ============================================================================
// Phase 1: Unified File System API - Backend Tools
// ============================================================================



/**
 * ExecuteQuery - Standalone query execution (backend tool)
 * Executes SQL without modifying any files.
 * DuckDB connections are handled in Node.js; all other types fall through to Python.
 */
registerTool('ExecuteQuery', async (args, user) => {
  const { query, connectionId, parameters = {}, maxChars: rawMaxChars } = args;
  return execQuery({ query, connectionId, parameters, maxChars: rawMaxChars }, user);
});

// ============================================================================
// Server-Run Fallback Handlers
//
// These handlers activate only when allowServerFallback=true (i.e. scheduled
// runs / remote execution with no browser client). Normal interactive chat
// always uses the client-side Redux-aware implementations instead.
// ============================================================================

/**
 * ReadFiles — server-side fallback.
 * Reads files directly from SQLite instead of the Redux store.
 * Uses readFilesServer() for consistent behavior with client-side:
 * - Includes references with parameter inheritance
 * - Computes effective queryResultIds
 */
registerToolFallback('ReadFiles', async (args, user) => {
  const { fileIds } = args as { fileIds: number[] };
  const files = await readFilesServer(fileIds, user, { executeQueries: false });
  return {
    content: { success: true, files },
    details: { success: true },
  };
});

/**
 * EditFile — server-side fallback.
 * File editing is not permitted during server-side evaluation runs.
 * Returns an informative error so the LLM can adjust its plan.
 */
registerToolFallback('EditFile', async () => {
  return {
    content: { success: false, error: 'EditFile is not available in server-run mode. File editing requires an interactive session.' },
    details: { success: false },
  };
});

/**
 * Navigate — server-side fallback.
 * UI navigation is not available during server-side evaluation runs.
 */
registerToolFallback('Navigate', async () => {
  return {
    content: { success: false, error: 'Navigate is not available in server-run mode. Navigation requires an interactive session.' },
    details: { success: false },
  };
});

/**
 * CreateFile — server-side fallback.
 * File creation requires an interactive session with Redux state.
 */
registerToolFallback('CreateFile', async () => {
  return {
    content: { success: false, error: 'CreateFile is not available in server-run mode. File creation requires an interactive session.' },
    details: { success: false },
  };
});

/**
 * PublishAll — server-side fallback.
 * Publishing files requires an interactive session with Redux state.
 */
registerToolFallback('PublishAll', async () => {
  return {
    content: { success: false, error: 'PublishAll is not available in server-run mode. Publishing requires an interactive session.' },
    details: { success: false },
  };
});

/**
 * Clarify — server-side fallback (overrides the primary handler).
 * In server-run mode there is no user to ask, so the agent is instructed
 * to figure it out on its own rather than waiting for a response.
 */
registerToolFallback('Clarify', async () => {
  return {
    content: 'Figure it out.',
    details: { success: true },
  };
});
