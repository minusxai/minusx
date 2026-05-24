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
import { registerTool } from './orchestrator';
import { searchDatabaseSchema } from '@/lib/search/schema-search';
import { searchFilesInFolder } from '@/lib/search/file-search';
import { executeQuery as execQuery } from '@/lib/api/execute-query.server';
import { validateQueryTablesLocal } from '@/lib/sql/validate-query-tables';
import { getVizSettingsWarning } from '@/lib/chart/viz-constraints';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { getNodeConnector } from '@/lib/connections';
import { fuzzyMatch } from '@/lib/connections/fuzzy-search';
import { executeFuzzyMatch, type FuzzyMatchToolArgs } from '@/lib/connections/fuzzy-match-tool';

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
 * FuzzyMatch - Fuzzy match a search term against distinct values in a text column.
 * Logic is shared with the v2 production FuzzyMatch tool via executeFuzzyMatch.
 */
registerTool('FuzzyMatch', async (args, user) => {
  return executeFuzzyMatch(args as unknown as FuzzyMatchToolArgs, user);
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
 * LoadSkill - Resolve user-defined Knowledge Base skills.
 * System skills are resolved directly in Python; unresolved LoadSkill calls
 * are delegated here as user-defined skills by name.
 */
registerTool('LoadSkill', async (args, _user, childResults) => {
  const name = String(args.name ?? '');

  if (!name) {
    return { success: false, error: 'name is required' };
  }

  if (childResults && childResults.length > 0) {
    const allChildren = childResults.flat();
    return allChildren[0].result;
  }

  throw new FrontendToolException({
    spawnedTools: [{
      type: 'function',
      function: {
        name: 'LoadSkillFrontend',
        arguments: { name }
      }
    }]
  });
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
  const { query, connectionId, parameters = {}, maxChars: rawMaxChars, _schema: whitelist, vizSettings } = args;
  if (Array.isArray(whitelist)) {
    const error = await validateQueryTablesLocal(query, whitelist);
    if (error) {
      return { content: { success: false, error }, details: { success: false, error } };
    }
  }
  const result = await execQuery({ query, connectionId, parameters, maxChars: rawMaxChars }, user);

  // Append viz constraint warning if vizSettings were provided. Pass the result
  // columns/types so type-dependent constraints (e.g. trend charts require a date
  // X axis) are caught — matching the chart renderer — not just structural ones.
  const parsedViz = vizSettings ? (typeof vizSettings === 'string' ? JSON.parse(vizSettings) : vizSettings) : null;
  const qr = (result.details as { queryResult?: { columns?: string[]; types?: string[] } } | undefined)?.queryResult;
  const vizWarning = getVizSettingsWarning(parsedViz, qr?.columns, qr?.types);
  if (vizWarning && result.content && typeof result.content === 'object') {
    (result.content as Record<string, any>).vizWarning = vizWarning;
  }

  return result;
});
