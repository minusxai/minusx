import { Type, type Static } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/tool';
import type { RunContext, ToolResult } from '@/orchestrator/types';
import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import { ConnectionContent } from '@/lib/types';
import { resolvePath } from '@/lib/mode/path-resolver';
import { FilesAPI } from '@/lib/data/files.server';
import { searchDatabaseSchema } from '@/lib/search/schema-search';
import '../types';

const SCHEMA = Type.Object({
  connection_id: Type.String({ description: 'the database connection ID to use' }),
  query: Type.Optional(Type.String({ description: "JSONPath query (starts with '$') or string search term" })),
  /** Underscore-prefixed: stripped from LLM schema, injected by AnalystAgent.buildAgentTools(). */
  _schema: Type.Optional(Type.Array(Type.Object({
    schema: Type.String(),
    tables: Type.Array(Type.String()),
  }))),
});

const SEARCH_DB_SCHEMA_DESCRIPTION = `Search database schema for tables, columns, and metadata.

Auto-detects query type: queries starting with '$' use JSONPath, others use weighted string search.

Query modes (auto-detected):
- No query: returns full schema. Use to inspect all tables/columns/metadata - NOT RECOMMENDED if tables > 20.
- String (no $ prefix): weighted scoring across schema/table/column names. e.g. "revenue", "customer".
- JSONPath (starts with $): structural queries. e.g. "$..columns[?(@.type=='VARCHAR')]".

Returns: {success, queryType: 'none'|'string'|'jsonpath', tableCount, schema|results}`;

export class SearchDBSchema extends Tool<typeof SCHEMA> {
  readonly name = 'SearchDBSchema';
  readonly description = SEARCH_DB_SCHEMA_DESCRIPTION;
  readonly schema = SCHEMA;

  async run({ connection_id, query, _schema: whitelistedSchema }: Static<typeof SCHEMA>, ctx: RunContext): Promise<ToolResult> {
    if (!ctx.user) {
      return { state: 'failure', error: 'SearchDBSchema requires authenticated user context' };
    }

    const connectionPath = resolvePath(ctx.user.mode, `/database/${connection_id}`);
    const connectionFile = await FilesAPI.loadFileByPath(connectionPath, ctx.user);

    const loadedConnection = await connectionLoader(connectionFile.data, ctx.user);
    const content = loadedConnection.content as ConnectionContent;
    const schemaData = content.schema || { schemas: [], updated_at: new Date().toISOString() };

    let result;
    if (Array.isArray(whitelistedSchema)) {
      const filteredSchemas = schemaData.schemas
        .map((s: { schema: string; tables: { table: string }[] }) => {
          const allowed = whitelistedSchema.find((w) => w.schema === s.schema);
          if (!allowed) return null;
          return { ...s, tables: s.tables.filter((t) => allowed.tables.includes(t.table)) };
        })
        .filter(Boolean);
      result = await searchDatabaseSchema(filteredSchemas as typeof schemaData.schemas, query);
    } else {
      result = await searchDatabaseSchema(schemaData.schemas, query);
    }
    return { state: 'success', content: result as Record<string, unknown> };
  }
}
