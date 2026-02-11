/**
 * Next.js Backend Tool Handlers
 *
 * Tool implementations that register themselves with the orchestrator.
 * Each tool calls registerTool() to make itself available for execution.
 */

import { ToolCall } from '@/lib/types';
import { executeQuery } from '@/lib/data/query-executor';
import { DocumentDB } from '@/lib/database/documents-db';
import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import { ConnectionContent } from '@/lib/types';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { FrontendToolException } from './frontend-tool-exception';
import { registerTool } from './orchestrator';
import { JSONPath } from 'jsonpath-plus';
import { searchInField } from '@/lib/search/file-search-utils';
import { searchFilesInFolder } from '@/lib/search/file-search';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';

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
 * ExecuteSQLQuery - Execute SQL queries against the database
 * If foreground=true, delegates to ExecuteSQLQueryForeground to update UI
 */
registerTool('ExecuteSQLQuery', async (args, user, childResults) => {
  // Check if resuming with child results (from foreground execution)
  if (childResults && childResults.length > 0) {
    // childResults is Array<Array<{...}>> - grouped by run_id
    // Flatten to get all child results
    const allChildren = childResults.flat();
    const frontendResult = allChildren[0];
    // Return the frontend tool's result as our result
    return frontendResult.result;
  }

  const { query, connection_id, foreground, vizSettings, parameters, references, file_id } = args;

  if (!query) {
    throw new Error('SQL query is required');
  }

  if (!connection_id) {
    throw new Error('connection_id is required');
  }

  // If foreground mode requested, spawn frontend tool
  if (foreground) {
    throw new FrontendToolException({
      spawnedTools: [
        {
          type: 'function',
          function: {
            name: 'ExecuteSQLQueryForeground',
            arguments: {  // Pass dict directly (matches Python FunctionCallMX: dict | str)
              query,
              connection_id,
              vizSettings,
              parameters,
              references,
              file_id
            }
          }
        }
      ]
    });
  }

  // Background mode - execute query and return results
  // Company ID header added automatically by pythonBackendFetch
  const result = await executeQuery(connection_id, query, {});

  return {
    success: true,
    columns: result.columns || [],
    types: result.types || [],
    rows: result.rows || [],
    rowCount: result.rows?.length || 0
  };
});

/**
 * Schema search result with relevance metadata
 */
interface SchemaSearchResult {
  schema: any;
  score: number;
  matchCount: number;
  relevantResults: Array<{
    field: 'schema' | 'table' | 'column';
    location: string; // e.g., "public.users.email"
    snippet: string;
    matchType: 'exact' | 'partial';
  }>;
}

/**
 * Search within schema hierarchy using weighted scoring
 * Reuses searchInField logic from file-search.ts
 */
async function searchSchemas(
  schemas: any[],
  query: string
): Promise<SchemaSearchResult[]> {
  const results: SchemaSearchResult[] = [];

  for (const schemaItem of schemas) {
    const schemaName = schemaItem.schema || '';
    const tables = schemaItem.tables || [];

    let totalMatches = 0;
    let totalScore = 0;
    const relevantResults: SchemaSearchResult['relevantResults'] = [];

    // Search schema name (weight: 3)
    const schemaStats = searchInField(schemaName, query, 'schema', 3);
    totalMatches += schemaStats.exactMatches + schemaStats.wordBoundaryMatches + schemaStats.partialMatches;
    totalScore += (schemaStats.exactMatches * 10 + schemaStats.wordBoundaryMatches * 5 + schemaStats.partialMatches * 1) * 3;

    if (schemaStats.snippets.length > 0) {
      relevantResults.push({
        field: 'schema',
        location: schemaName,
        snippet: schemaStats.snippets[0],
        matchType: schemaStats.exactMatches > 0 ? 'exact' : 'partial'
      });
    }

    // Search tables and columns
    for (const table of tables) {
      const tableName = table.table || '';
      const columns = table.columns || [];

      // Search table name (weight: 2)
      const tableStats = searchInField(tableName, query, 'table', 2);
      totalMatches += tableStats.exactMatches + tableStats.wordBoundaryMatches + tableStats.partialMatches;
      totalScore += (tableStats.exactMatches * 10 + tableStats.wordBoundaryMatches * 5 + tableStats.partialMatches * 1) * 2;

      if (tableStats.snippets.length > 0) {
        relevantResults.push({
          field: 'table',
          location: `${schemaName}.${tableName}`,
          snippet: tableStats.snippets[0],
          matchType: tableStats.exactMatches > 0 ? 'exact' : 'partial'
        });
      }

      // Search column names (weight: 1)
      for (const column of columns) {
        const columnName = column.name || '';
        const columnStats = searchInField(columnName, query, 'column', 1);
        totalMatches += columnStats.exactMatches + columnStats.wordBoundaryMatches + columnStats.partialMatches;
        totalScore += (columnStats.exactMatches * 10 + columnStats.wordBoundaryMatches * 5 + columnStats.partialMatches * 1) * 1;

        if (columnStats.snippets.length > 0 && relevantResults.length < 10) {
          relevantResults.push({
            field: 'column',
            location: `${schemaName}.${tableName}.${columnName}`,
            snippet: columnStats.snippets[0],
            matchType: columnStats.exactMatches > 0 ? 'exact' : 'partial'
          });
        }
      }
    }

    // Only include schemas with matches
    if (totalMatches > 0) {
      // Normalize score (0-1 range, capped at 1.0)
      const maxPossible = 30 * 3; // Max score from highest weight field
      const score = Math.min(totalScore / maxPossible, 1.0);

      results.push({
        schema: schemaItem,
        score,
        matchCount: totalMatches,
        relevantResults: relevantResults.slice(0, 10) // Limit to top 10
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

/**
 * Core search logic for database schemas - exported for testing
 * Auto-detects: queries starting with '$' use JSONPath, others use weighted string search
 */
export async function searchDatabaseSchema(
  schemas: any[],
  query?: string
): Promise<{
  success: boolean;
  schema?: any;
  results?: SchemaSearchResult[];
  queryType: 'none' | 'jsonpath' | 'string';
  tableCount: number;
}> {
  // No query - return full schema
  if (!query) {
    return {
      success: true,
      schema: schemas,
      queryType: 'none',
      tableCount: schemas.reduce((acc: number, s: any) =>
        acc + (s.tables?.length || 0), 0
      )
    };
  }

  // Auto-detect: JSONPath starts with '$'
  const isJSONPath = query.startsWith('$');

  if (isJSONPath) {
    // JSONPath query with path preservation
    try {
      // Use resultType: 'all' to get both paths and values
      const pathResults = JSONPath({
        path: query,
        json: schemas,
        resultType: 'all'
      });

      // Enrich results with schema/table context from paths
      const enrichedResults = pathResults.map((item: any) => {
        const value = item.value;
        const path = item.path; // e.g., "$[0]['tables'][2]['columns'][5]"

        // Parse path to extract indices
        const schemaMatch = path.match(/\$\[(\d+)\]/);
        const tableMatch = path.match(/\['tables'\]\[(\d+)\]/);

        if (schemaMatch) {
          const schemaIdx = parseInt(schemaMatch[1]);
          const schemaName = schemas[schemaIdx]?.schema;

          // Add schema context to result
          if (typeof value === 'object' && value !== null) {
            const enriched: any = { ...value };

            if (schemaName) {
              enriched._schema = schemaName;
            }

            // Add table context if present in path
            if (tableMatch) {
              const tableIdx = parseInt(tableMatch[1]);
              const tableName = schemas[schemaIdx]?.tables?.[tableIdx]?.table;
              if (tableName) {
                enriched._table = tableName;
              }
            }

            return enriched;
          }
        }

        return value;
      });

      const tableCount = Array.isArray(enrichedResults)
        ? enrichedResults.reduce((acc: number, item: any) => {
            if (item?.tables) return acc + item.tables.length;
            return acc;
          }, 0)
        : 0;

      return {
        success: true,
        schema: enrichedResults,
        queryType: 'jsonpath',
        tableCount
      };
    } catch (error) {
      throw new Error(`Invalid JSONPath query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // String search with weighted scoring
  const searchResults = await searchSchemas(schemas, query);

  return {
    success: true,
    results: searchResults,
    queryType: 'string',
    tableCount: searchResults.reduce((acc, r) =>
      acc + (r.schema.tables?.length || 0), 0
    )
  };
}

/**
 * SearchDBSchema - Search database schema for tables and columns
 * Auto-detects: queries starting with '$' use JSONPath, others use weighted string search
 */
registerTool('SearchDBSchema', async (args, user) => {
  const { query, connection_id } = args;

  if (!connection_id) {
    throw new Error('connection_id is required');
  }

  // Load connection file with cached schema (via loader)
  const connectionPath = resolvePath(user.mode, `/database/${connection_id}`);
  const connectionFile = await DocumentDB.getByPath(connectionPath, user.companyId);

  if (!connectionFile) {
    throw new Error(`Connection '${connection_id}' not found`);
  }

  // Apply connection loader to get schema (cached or fresh)
  const loadedConnection = await connectionLoader(connectionFile, user);
  const content = loadedConnection.content as ConnectionContent;
  const schemaData = content.schema || { schemas: [], updated_at: new Date().toISOString() };

  // Delegate to core search logic
  return searchDatabaseSchema(schemaData.schemas, query);
});

/**
 * GetAllQuestions - Get all available questions that can be added to dashboard
 * Matches QuestionBrowserPanel behavior
 */
registerTool('GetAllQuestions', async (args, user) => {
  const { folder_path, search_query, exclude_ids } = args;

  // Use user's home_folder if no folder specified (resolve with mode)
  const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
  const searchPath = folder_path || resolvedHomeFolder;

  // Get all questions in folder (like QuestionBrowserPanel does)
  const { data: questionFiles } = await FilesAPI.getFiles({
    paths: [searchPath],
    type: 'question',
    depth: 999  // All subfolders
  }, user);

  // Load full content for each question
  const questionIds = questionFiles.map((f: any) => f.id);
  const { data: fullQuestions } = await FilesAPI.loadFiles(questionIds, user);

  // Map to simplified format with all needed fields
  let questions = fullQuestions.map((q: any) => ({
    id: q.id,
    name: q.name,
    path: q.path,
    description: q.content.description || '',
    query: q.content.query || '',
    vizSettings: q.content.vizSettings,
    parameters: q.content.parameters || [],
    database_name: q.content.database_name
  }));

  // Filter by exclude_ids if provided
  if (exclude_ids && Array.isArray(exclude_ids) && exclude_ids.length > 0) {
    questions = questions.filter((q: any) => !exclude_ids.includes(q.id));
  }

  // Filter by search query if provided
  if (search_query && search_query.trim()) {
    const searchLower = search_query.toLowerCase();
    questions = questions.filter((q: any) =>
      q.name.toLowerCase().includes(searchLower) ||
      q.description?.toLowerCase().includes(searchLower)
    );
  }

  // Return question list
  return {
    success: true,
    questions,
    count: questions.length,
    folder_path: searchPath
  };
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
 * GetFiles - Load files by IDs with optional content
 */
registerTool('GetFiles', async (args, user) => {
  const { ids, include_content = false } = args;

  // Validation
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('ids is required and must be a non-empty array');
  }

  if (!ids.every((id: any) => typeof id === 'number')) {
    throw new Error('All IDs must be numbers');
  }

  // Load files
  if (include_content) {
    const { data: files } = await FilesAPI.loadFiles(ids, user);
    return {
      success: true,
      files,
      count: files.length
    };
  } else {
    // Metadata only - more efficient
    const { data: allFiles } = await FilesAPI.getFiles({
      paths: [],
      depth: 999
    }, user);

    const requestedFiles = allFiles.filter(f => ids.includes(f.id));
    return {
      success: true,
      files: requestedFiles,
      count: requestedFiles.length
    };
  }
});

/**
 * PresentFinalAnswer - Present final analysis to user
 * Delegates to frontend for special rendering (collapsed exploration + highlighted answer)
 */
registerTool('PresentFinalAnswer', async (args, _user, childResults) => {
  // Check if resuming with child results (from frontend execution)
  if (childResults && childResults.length > 0) {
    // childResults is Array<Array<{...}>> - grouped by run_id
    // Flatten to get all child results
    const allChildren = childResults.flat();
    const frontendResult = allChildren[0];
    // Return the frontend tool's result as our result
    return frontendResult.result;
  }

  const { answer } = args;

  if (!answer || typeof answer !== 'string') {
    throw new Error('answer is required and must be a string');
  }

  // Pass to frontend for special rendering
  throw new FrontendToolException({
    spawnedTools: [
      {
        type: 'function',
        function: {
          name: 'PresentFinalAnswerFrontend',
          arguments: { answer }
        }
      }
    ]
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
