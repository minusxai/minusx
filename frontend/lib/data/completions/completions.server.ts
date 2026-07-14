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
import { DatabaseWithSchema } from '@/lib/types';
import { FilesAPI } from '@/lib/data/files.server';
import { getCompletionsLocal } from '@/lib/sql/autocomplete';
import { getMentionCompletionsLocal } from '@/lib/sql/mention-completions';
import { parseSqlToIrLocal, UnsupportedSQLError } from '@/lib/sql/sql-to-ir';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';

/**
 * Server-side implementation of completions data layer
 * Loads schema and questions, then runs completions locally (WASM)
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

    // Run mention completions locally
    try {
      const suggestions = getMentionCompletionsLocal(
        prefix,
        schemaData,
        availableQuestions,
        mentionType,
      );
      return {
        suggestions,
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      console.error('[Completions] Error:', error);
      return { suggestions: [] };
    }

    //   console.error('[Completions] Error:', error);
    //   return { suggestions: [] };
    // }
  }

  async getSqlCompletions(options: SqlCompletionsOptions, user: EffectiveUser): Promise<SqlCompletionsResult> {
    const { query, cursorOffset, context } = options;

    const schemaData = [...(context.schemaData || [])];

    // Run autocomplete locally via WASM
    try {
      const completions = await getCompletionsLocal(
        query,
        cursorOffset,
        schemaData,
        context.connectionType,
      );
      return {
        suggestions: completions.map(c => ({
          label: c.label,
          kind: c.kind as any,
          insertText: c.insert_text,
          insert_text: c.insert_text,
          detail: c.detail,
          documentation: c.documentation,
          sort_text: c.sort_text,
        })),
        metadata: { timestamp: Date.now() },
      };
    } catch (error) {
      console.error('[Completions] SQL autocomplete error:', error);
      return { suggestions: [] };
    }

  }

  async sqlToIR(options: SqlToIROptions): Promise<SqlToIRResult> {
    const { sql, dialect } = options;

    try {
      const ir = await parseSqlToIrLocal(sql, dialect);
      return { success: true, ir };
    } catch (error) {
      if (error instanceof UnsupportedSQLError) {
        return {
          success: false,
          error: error.message,
          unsupportedFeatures: error.features,
          hint: error.hint,
        };
      }
      console.error('[Completions] SQL to IR error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

  }

  async irToSql(options: IRToSqlOptions): Promise<IRToSqlResult> {
    const { ir, dialect } = options;

    try {
      const sql = irToSqlLocal(ir, dialect);
      return { success: true, sql };
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
