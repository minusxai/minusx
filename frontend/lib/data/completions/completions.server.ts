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
import { getWhitelistForPath } from '@/lib/sql/whitelist-resolver.server';
import { getViewsForPath } from '@/lib/views/views.server';
import { viewsAsSchemaTables } from '@/lib/types/views';
import { VIEWS_SCHEMA } from '@/lib/types';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { SchemaEntry } from '@/lib/connections/base';
import { getCompletionsLocal } from '@/lib/sql/autocomplete';
import { getMentionCompletionsLocal, type AvailableMentionFile } from '@/lib/sql/mention-completions';
import { parseSqlToIrLocal, UnsupportedSQLError } from '@/lib/sql/sql-to-ir';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';

/**
 * Narrow a connection's introspected schema to what the caller's context
 * actually exposes.
 *
 * Every suggestion surface here hands back schema METADATA (table and column
 * names), and metadata is part of what a whitelist curates — a table hidden
 * from the picker but named by the endpoint behind it is not hidden. So the
 * whitelist is resolved SERVER-SIDE from the caller's own context, exactly as
 * query execution resolves it (`getWhitelistForPath`), and a client-supplied
 * whitelist is never trusted: `getMentions` used to take one straight from the
 * request body, so omitting the field returned the entire warehouse.
 *
 * `null` from the resolver means genuinely unrestricted → pass everything
 * through. An empty array means the context exposes nothing → return nothing.
 *
 * Curated VIEWS are then appended under `_views`. They are exposed by the
 * context that defines or inherits them and the query seam accepts them, but
 * they exist nowhere in the connector's introspected schema — so without this
 * the object a curated workspace most wants people to reach for was the one
 * object no picker, mention or column list would ever name.
 */
async function whitelistConnectionSchemas(
  schemas: SchemaEntry[],
  connectionName: string,
  user: EffectiveUser,
  /**
   * A caller-supplied narrowing (the client's cached view of the context). It can
   * only ever REMOVE from the server-resolved set — never add. Callers legitimately
   * narrow (the editor scopes suggestions to the context it is showing); what they
   * may not do is widen, which omitting the field used to achieve.
   */
  clientNarrowing?: DatabaseWithSchema[],
): Promise<SchemaEntry[]> {
  const homeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
  const whitelist = await getWhitelistForPath(homeFolder, connectionName, user);

  const keep = (list: SchemaEntry[], allowed: Map<string, Set<string>>): SchemaEntry[] =>
    list
      .map((s) => {
        const tables = allowed.get((s.schema ?? '').toLowerCase());
        if (!tables) return { ...s, tables: [] };
        return { ...s, tables: (s.tables ?? []).filter((t) => tables.has(t.table.toLowerCase())) };
      })
      .filter((s) => s.tables.length > 0);

  const toAllowed = (entries: Array<{ schema?: string; tables?: Array<{ table: string }> }>) => {
    const m = new Map<string, Set<string>>();
    for (const e of entries) {
      m.set((e.schema ?? '').toLowerCase(),
        new Set((e.tables ?? []).map((t) => t.table.toLowerCase())));
    }
    return m;
  };

  // `null` = genuinely unrestricted; anything else (including `[]`, "exposes
  // nothing") is the ceiling.
  let exposed = whitelist === null ? schemas : keep(schemas, toAllowed(whitelist));

  if (clientNarrowing) {
    const clientEntry = clientNarrowing.find((d) => d.databaseName === connectionName)
      ?? clientNarrowing[0];
    exposed = keep(exposed, toAllowed(clientEntry?.schemas ?? []));
  }

  // After the narrowing, not before: the client's cached whitelist describes
  // real tables and would drop `_views` for not being in it.
  const views = viewsAsSchemaTables(
    await getViewsForPath(homeFolder, connectionName, user),
    connectionName,
  );
  return views.length > 0 ? [...exposed, { schema: VIEWS_SCHEMA, tables: views }] : exposed;
}

/**
 * Server-side implementation of completions data layer
 * Loads schema and questions, then runs completions locally (WASM)
 */
class CompletionsDataLayerServer implements ICompletionsDataLayer {
  async getMentions(options: MentionsOptions, user: EffectiveUser): Promise<MentionsResult> {
    const { prefix, mentionType, databaseName, whitelistedSchemas } = options;

    // `whitelistedSchemas` is no longer the source of truth — it used to be, so a
    // caller that simply omitted it received the entire connection. It is now
    // only a NARROWING applied on top of the server-resolved whitelist.
    let schemaData: DatabaseWithSchema[] = [];

    if (databaseName) {
      try {
        // Load all connections and find the one matching databaseName
        const connectionsResult = await FilesAPI.getFiles({ type: 'connection' }, user);
        const connection = connectionsResult.data.find((f: any) => f.name === databaseName);

        if (connection) {
          // Load full connection with content
          const fullConnectionResult = await FilesAPI.loadFile(connection.id, user);
          const connectionContent = fullConnectionResult.data.content as any;
          if (connectionContent?.schema?.schemas) {
            const exposed = await whitelistConnectionSchemas(
              connectionContent.schema.schemas, connection.name, user, whitelistedSchemas,
            );
            schemaData = [{ databaseName: connection.name, schemas: exposed }];
          }
        }
      } catch (error) {
        console.warn('[Completions] Failed to load schema:', error);
      }
    }

    // Get available saved files for mentions
    const availableFiles: AvailableMentionFile[] = [];
    try {
      // Load questions
      const questionsResult = await FilesAPI.getFiles({ type: 'question' }, user);
      questionsResult.data.forEach((q: any) => {
        availableFiles.push({
          id: q.id,
          name: q.name,
          type: 'question',
          alias: q.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + q.id
        });
      });

      // Load dashboards (both @ and @@ show saved files)
      const dashboardsResult = await FilesAPI.getFiles({ type: 'dashboard' }, user);
      dashboardsResult.data.forEach((d: any) => {
        availableFiles.push({
          id: d.id,
          name: d.name,
          type: 'dashboard',
          alias: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + d.id
        });
      });

      // Load stories
      const storiesResult = await FilesAPI.getFiles({ type: 'story' }, user);
      storiesResult.data.forEach((s: any) => {
        availableFiles.push({
          id: s.id,
          name: s.name,
          type: 'story',
          alias: s.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + s.id
        });
      });
    } catch (error) {
      console.warn('[Completions] Failed to load mentionable files:', error);
    }

    // Run mention completions locally
    try {
      const suggestions = getMentionCompletionsLocal(
        prefix,
        schemaData,
        availableFiles,
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

      // Only what this caller's context exposes — the picker is a read of the
      // whitelist like any other.
      const exposedSchemas = await whitelistConnectionSchemas(
        connectionContent.schema.schemas, connection.name, user,
      );

      // Extract all tables from all schemas
      const tables: TableSuggestionsResult['tables'] = [];

      for (const schemaObj of exposedSchemas) {
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

      // Search only the exposed set: a withheld table must read as "not found"
      // here exactly as it does everywhere else, rather than handing back its
      // column names to anyone who guesses it.
      const exposedSchemas = await whitelistConnectionSchemas(
        connectionContent.schema.schemas, connection.name, user,
      );

      // Find the specified table
      let targetTable: any = null;

      for (const schemaObj of exposedSchemas) {
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
