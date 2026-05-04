import { Type, type Static } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/tool';
import type { RunContext, ToolResult } from '@/orchestrator/types';
import { executeQuery as execQuery } from '@/lib/api/execute-query.server';
import { validateQueryTablesLocal } from '@/lib/sql/validate-query-tables';
import { getVizSettingsWarning } from '@/lib/chart/viz-constraints';
import '../types';

const SCHEMA = Type.Object({
  query: Type.String({ description: 'SQL query to execute' }),
  connectionId: Type.String({ description: 'Database connection name' }),
  parameters: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: 'Query parameters as key-value pairs' })),
  vizSettings: Type.Optional(Type.String({ description: 'JSON string for visualization settings' })),
  maxChars: Type.Optional(Type.Integer({ description: 'Max characters of table output (default 10,000, max 100,000)' })),
  /** Underscore-prefixed: stripped from LLM schema, injected by AnalystAgent.buildAgentTools(). */
  _schema: Type.Optional(Type.Array(Type.Object({
    schema: Type.String(),
    tables: Type.Array(Type.String()),
  }))),
});

const EXECUTE_QUERY_DESCRIPTION = `Execute a standalone SQL query without modifying any files.

Use this to run ad-hoc queries for data exploration. Results are cached but not associated with any question file.

Returns a JSON object with:
- data: GFM markdown containing the first shownRows rows of output
- totalRows: total rows returned by the query
- shownRows: number of rows included in the data field
- truncated: true when data was cut short (shownRows < totalRows)

Text table data is truncated at maxChars characters (default 10,000):
- Increase maxChars (up to 100,000) to expose more rows in text form.
- To page through results, add OFFSET N to the SQL.`;

export class ExecuteQuery extends Tool<typeof SCHEMA> {
  readonly name = 'ExecuteQuery';
  readonly description = EXECUTE_QUERY_DESCRIPTION;
  readonly schema = SCHEMA;

  async run(
    { query, connectionId, parameters = {}, maxChars, vizSettings, _schema: whitelist }: Static<typeof SCHEMA>,
    ctx: RunContext,
  ): Promise<ToolResult> {
    if (!ctx.user) {
      return { state: 'failure', error: 'ExecuteQuery requires authenticated user context' };
    }

    if (Array.isArray(whitelist)) {
      // _schema uses string[] for tables (Python style); validateQueryTablesLocal expects {table: string}[]
      const adapted = whitelist.map((w) => ({
        schema: w.schema,
        tables: w.tables.map((t) => ({ table: t })),
      }));
      const validationError = await validateQueryTablesLocal(query, adapted);
      if (validationError) {
        return { state: 'failure', error: validationError };
      }
    }

    const result = await execQuery({ query, connectionId, parameters, maxChars }, ctx.user);

    const parsedViz = vizSettings
      ? (typeof vizSettings === 'string' ? JSON.parse(vizSettings) : vizSettings)
      : null;
    const vizWarning = getVizSettingsWarning(parsedViz);
    if (vizWarning && result.content && typeof result.content === 'object') {
      (result.content as Record<string, unknown>).vizWarning = vizWarning;
    }

    // execQuery returns { content, details } shaped result. Adapt to ToolResult.
    const content = (result.content && typeof result.content === 'object'
      ? result.content
      : { result: result.content }) as Record<string, unknown>;
    if ('success' in content && content.success === false) {
      return { state: 'failure', error: String(content.error ?? 'Query execution failed') };
    }
    return { state: 'success', content };
  }
}
