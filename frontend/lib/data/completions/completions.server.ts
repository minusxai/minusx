import 'server-only';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { ICompletionsDataLayer } from './completions.interface';
import {
  MentionsOptions,
  MentionsResult,
  SqlCompletionsOptions,
  SqlCompletionsResult,
  SqlToIROptions,
  SqlToIRResult,
  IRToSqlOptions,
  IRToSqlResult,
  TableSuggestionsOptions,
  TableSuggestionsResult,
  ColumnSuggestionsOptions,
  ColumnSuggestionsResult,
} from './types';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { DatabaseWithSchema, QuestionContent } from '@/lib/types';
import { FilesAPI } from '@/lib/data/files.server';
import { CTEfyQuery, ResolvedReference } from '@/lib/sql/query-composer';
import { extractReferencesFromSQL, parseReferenceAlias } from '@/lib/sql/sql-references';

/**
 * Server-side implementation of completions data layer
 * Loads schema and questions, then calls Python backend
 */
class CompletionsDataLayerServer implements ICompletionsDataLayer {
  async getMentions(options: MentionsOptions, user: EffectiveUser): Promise<MentionsResult> {
    const { prefix, mentionType, databaseName, whitelistedSchemas } = options;

    // Use whitelisted schemas if provided (from context), otherwise load from connections
    let schemaData: DatabaseWithSchema[] = whitelistedSchemas || [];

    // Only load from connections if no whitelisted schemas provided
    if (!whitelistedSchemas && databaseName) {
      try {
        // Load all connections and find the one matching databaseName
        const connectionsResult = await FilesAPI.getFiles({ type: 'connection' }, user);
        const connection = connectionsResult.data.find((f: any) => f.name === databaseName);

        if (connection) {
          // Load full connection with content
          const fullConnectionResult = await FilesAPI.loadFile(connection.id, user);
          const connectionContent = fullConnectionResult.data.content as any;
          if (connectionContent?.schema?.schemas) {
            // Wrap the schema in DatabaseWithSchema format
            schemaData = [{
              databaseName: connection.name,
              schemas: connectionContent.schema.schemas
            }];
          }
        }
      } catch (error) {
        console.warn('[Completions] Failed to load schema:', error);
      }
    }

    // Get available questions and dashboards for mentions
    const availableQuestions: any[] = [];
    try {
      // Load questions
      const questionsResult = await FilesAPI.getFiles({ type: 'question' }, user);
      questionsResult.data.forEach((q: any) => {
        availableQuestions.push({
          id: q.id,
          name: q.name,
          type: 'question',
          alias: q.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + q.id
        });
      });

      // Load dashboards (both @ and @@ show dashboards)
      const dashboardsResult = await FilesAPI.getFiles({ type: 'dashboard' }, user);
      dashboardsResult.data.forEach((d: any) => {
        availableQuestions.push({
          id: d.id,
          name: d.name,
          type: 'dashboard',
          alias: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + d.id
        });
      });
    } catch (error) {
      console.warn('[Completions] Failed to load questions/dashboards:', error);
    }

    // Call Python backend
    try {
      const response = await pythonBackendFetch('/api/chat-mentions', {
        method: 'POST',
        body: JSON.stringify({
          prefix,
          schema_data: schemaData,
          available_questions: availableQuestions,
          mention_type: mentionType
        }),
      });

      if (!response.ok) {
        console.error('[Completions] Backend error:', await response.text());
        return { suggestions: [] };
      }

      const data = await response.json();
      return {
        suggestions: data.suggestions || [],
        metadata: {
          timestamp: Date.now()
        }
      };
    } catch (error) {
      console.error('[Completions] Error:', error);
      return { suggestions: [] };
    }
  }

  async getSqlCompletions(options: SqlCompletionsOptions, user: EffectiveUser): Promise<SqlCompletionsResult> {
    const { query, cursorOffset, context } = options;

    // Use already resolved references from context if provided, otherwise load dynamically
    let resolvedReferences: ResolvedReference[] = context.resolvedReferences || [];

    // If no resolved references provided, extract and load them dynamically
    if (resolvedReferences.length === 0) {
      const aliasesInQuery = extractReferencesFromSQL(query);

      for (const alias of aliasesInQuery) {
        const parsed = parseReferenceAlias(alias);
        if (!parsed) {
          continue; // Invalid alias format
        }

        try {
          const result = await FilesAPI.loadFile(parsed.id, user);
          if (result.data?.content && result.data.type === 'question') {
            const content = result.data.content as QuestionContent;
            resolvedReferences.push({
              id: parsed.id,
              alias: alias,
              query: content.query
            });
          }
        } catch (error) {
          // Question not found or access denied, skip this reference
          console.warn(`[Completions] Failed to load reference ${alias}:`, error);
        }
      }
    }

    // Infer columns for each resolved reference and inject as virtual schema tables
    const schemaData = [...(context.schemaData || [])];
    for (const ref of resolvedReferences) {
      if (!ref.inferredColumns && ref.query) {
        try {
          const inferResponse = await pythonBackendFetch('/api/infer-columns', {
            method: 'POST',
            body: JSON.stringify({
              query: ref.query,
              schema_data: context.schemaData || [],
            }),
          });
          if (inferResponse.ok) {
            const inferData = await inferResponse.json();
            ref.inferredColumns = inferData.columns || [];
          }
        } catch (err) {
          console.warn(`[Completions] Failed to infer columns for ref ${ref.alias}:`, err);
        }
      }

      if (ref.inferredColumns && ref.inferredColumns.length > 0) {
        // Find or create the entry for the current databaseName
        const dbName = context.databaseName || '';
        let dbEntry = schemaData.find(d => d.databaseName === dbName);
        if (!dbEntry) {
          dbEntry = { databaseName: dbName, schemas: [] };
          schemaData.push(dbEntry);
        }

        // Find or create a schema bucket for virtual tables (use empty schema name)
        let virtualSchema = dbEntry.schemas.find((s: any) => s.schema === '');
        if (!virtualSchema) {
          virtualSchema = { schema: '', tables: [] };
          dbEntry.schemas.push(virtualSchema);
        }

        // Add virtual table for this reference (alias → columns)
        const existingIdx = virtualSchema.tables.findIndex((t: any) => t.table === ref.alias);
        const virtualTable = {
          table: ref.alias,
          columns: ref.inferredColumns.map(c => ({ name: c.name, type: c.type })),
        };
        if (existingIdx >= 0) {
          virtualSchema.tables[existingIdx] = virtualTable;
        } else {
          virtualSchema.tables.push(virtualTable);
        }

        // Also inject virtual tables for any SQL aliases used for this reference
        // in the original query (e.g. "FROM @revenue_1 r" → inject table "r" too).
        // This allows Python's dot-completion fallback to find columns when parse fails.
        const SQL_KEYWORDS = new Set(['on', 'where', 'join', 'inner', 'left', 'right', 'outer',
          'full', 'cross', 'group', 'order', 'having', 'limit', 'union', 'except', 'intersect',
          'as', 'and', 'or', 'not', 'in', 'is', 'null', 'between', 'like', 'select', 'from', 'with']);
        const aliasPattern = new RegExp(`@${ref.alias}\\s+(\\w+)`, 'gi');
        let aliasMatch: RegExpExecArray | null;
        while ((aliasMatch = aliasPattern.exec(query)) !== null) {
          const sqlAlias = aliasMatch[1];
          if (!SQL_KEYWORDS.has(sqlAlias.toLowerCase()) && sqlAlias.toLowerCase() !== ref.alias.toLowerCase()) {
            const existingAliasIdx = virtualSchema.tables.findIndex((t: any) => t.table === sqlAlias);
            if (existingAliasIdx < 0) {
              virtualSchema.tables.push({
                table: sqlAlias,
                columns: ref.inferredColumns!.map(c => ({ name: c.name, type: c.type })),
              });
            }
          }
        }
      }
    }

    // Convert @references to CTEs if needed and adjust cursor offset
    let processedQuery = query;
    let adjustedCursorOffset = cursorOffset;

    if (resolvedReferences.length > 0) {
      processedQuery = CTEfyQuery(query, resolvedReferences);

      // Adjust cursor offset:
      // 1. CTE section is added before the query
      // 2. Each @alias is replaced with alias (loses @ char)

      // Calculate CTE section length (everything before the main query)
      const cteSection = processedQuery.substring(0, processedQuery.lastIndexOf('\n') + 1);

      // Count how many @ symbols were removed before cursor position
      const textBeforeCursor = query.substring(0, cursorOffset);
      let atSymbolsRemoved = 0;
      resolvedReferences.forEach(ref => {
        const pattern = new RegExp(`@${ref.alias}\\b`, 'g');
        const matches = textBeforeCursor.match(pattern);
        if (matches) {
          atSymbolsRemoved += matches.length;
        }
      });

      adjustedCursorOffset = cteSection.length + cursorOffset - atSymbolsRemoved;
    }

    // Call Python backend
    try {
      const response = await pythonBackendFetch('/api/sql-autocomplete', {
        method: 'POST',
        body: JSON.stringify({
          query: processedQuery,
          cursor_offset: adjustedCursorOffset,
          schema_data: schemaData,
          database_name: context.databaseName,
        }),
      });

      if (!response.ok) {
        console.error('[Completions] SQL autocomplete backend error:', await response.text());
        return { suggestions: [] };
      }

      const data = await response.json();
      return {
        suggestions: data.suggestions || [],
        metadata: {
          timestamp: Date.now()
        }
      };
    } catch (error) {
      console.error('[Completions] SQL autocomplete error:', error);
      return { suggestions: [] };
    }
  }

  async sqlToIR(options: SqlToIROptions): Promise<SqlToIRResult> {
    const { sql, databaseName } = options;

    try {
      const response = await pythonBackendFetch('/api/sql-to-ir', {
        method: 'POST',
        body: JSON.stringify({
          sql,
          database_name: databaseName,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Completions] SQL to IR backend error:', errorText);
        return {
          success: false,
          error: 'Failed to parse SQL',
        };
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[Completions] SQL to IR error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async irToSql(options: IRToSqlOptions): Promise<IRToSqlResult> {
    const { ir } = options;

    try {
      // Call Python backend - single source of truth for IR→SQL conversion
      const response = await pythonBackendFetch('/api/ir-to-sql', {
        method: 'POST',
        body: JSON.stringify({ ir }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Completions] IR to SQL backend error:', errorText);
        return {
          success: false,
          error: 'Failed to generate SQL',
        };
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[Completions] IR to SQL error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getTableSuggestions(options: TableSuggestionsOptions, user: EffectiveUser): Promise<TableSuggestionsResult> {
    const { databaseName } = options;

    try {
      // Load connection to get schema
      const connectionsResult = await FilesAPI.getFiles({ type: 'connection' }, user);
      const connection = connectionsResult.data.find((f: any) => f.name === databaseName);

      if (!connection) {
        return {
          success: false,
          error: `Connection '${databaseName}' not found`,
        };
      }

      // Load full connection with schema
      const fullConnectionResult = await FilesAPI.loadFile(connection.id, user);
      const connectionContent = fullConnectionResult.data.content as any;

      if (!connectionContent?.schema?.schemas) {
        return {
          success: false,
          error: 'Connection has no schema data',
        };
      }

      // Extract all tables from all schemas
      const tables: TableSuggestionsResult['tables'] = [];

      for (const schemaObj of connectionContent.schema.schemas) {
        const schemaName = schemaObj.schema;
        for (const tableObj of schemaObj.tables || []) {
          const tableName = tableObj.table;
          tables.push({
            name: tableName,
            schema: schemaName !== 'default' ? schemaName : undefined,
            displayName: schemaName !== 'default' ? `${schemaName}.${tableName}` : tableName,
          });
        }
      }

      return {
        success: true,
        tables: tables.sort((a: any, b: any) => a.displayName.localeCompare(b.displayName)),
      };
    } catch (error) {
      console.error('[Completions] Get table suggestions error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getColumnSuggestions(options: ColumnSuggestionsOptions, user: EffectiveUser): Promise<ColumnSuggestionsResult> {
    const { databaseName, table, schema } = options;

    try {
      // Load connection to get schema
      const connectionsResult = await FilesAPI.getFiles({ type: 'connection' }, user);
      const connection = connectionsResult.data.find((f: any) => f.name === databaseName);

      if (!connection) {
        return {
          success: false,
          error: `Connection '${databaseName}' not found`,
        };
      }

      // Load full connection with schema
      const fullConnectionResult = await FilesAPI.loadFile(connection.id, user);
      const connectionContent = fullConnectionResult.data.content as any;

      if (!connectionContent?.schema?.schemas) {
        return {
          success: false,
          error: 'Connection has no schema data',
        };
      }

      // Find the specified table
      let targetTable: any = null;

      for (const schemaObj of connectionContent.schema.schemas) {
        // If schema specified, only search in that schema
        if (schema && schemaObj.schema !== schema) {
          continue;
        }

        const foundTable = schemaObj.tables?.find((t: any) => t.table === table);
        if (foundTable) {
          targetTable = foundTable;
          break;
        }
      }

      if (!targetTable) {
        return {
          success: false,
          error: `Table '${schema ? schema + '.' : ''}${table}' not found`,
        };
      }

      // Extract columns
      const columns: ColumnSuggestionsResult['columns'] = (targetTable.columns || []).map((col: any) => ({
        name: col.name,
        type: col.type,
        displayName: col.name,
      })).sort((a: any, b: any) => a.name.localeCompare(b.name));

      return {
        success: true,
        columns,
      };
    } catch (error) {
      console.error('[Completions] Get column suggestions error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * Singleton instance for server-side completions
 */
export const CompletionsAPI = new CompletionsDataLayerServer();
