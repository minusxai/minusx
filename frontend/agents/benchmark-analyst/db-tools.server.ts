// Production DB tools. Extends `Base*` variants from `./db-tools` to plug
// in the server-side `runQuery` / `loadConnectionSchema` chokepoints.
//
// Server-only: `runQuery` transitively imports `ConnectionsAPI` →
// `auth-helpers` → `next-auth`, none of which load in a plain Node CLI
// process. The benchmark CLI imports `./db-tools` (Base classes only) and
// never reaches this file.

import 'server-only';
import { Type } from 'typebox';
import type { TSchema } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { runQueryStream } from '@/lib/connections/run-query';
import { getCachedResultBounded } from '@/lib/query-cache/execute.server';
import { resolveCachePolicy } from '@/lib/query-cache/policy.server';
import { AGENT_DRAIN_MAX_BYTES, AGENT_DRAIN_MAX_ROWS } from '@/lib/chat/compress-augmented';
import { loadConnectionSchema } from '@/lib/connections/load-schema';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { QueryResult, SchemaEntry } from '@/lib/connections/base';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import { executeFuzzyMatch } from '@/lib/connections/fuzzy-match-tool';
import { renderChartToJpeg } from '@/lib/chart/render-chart';
import { renderVizEnvelopeToJpeg } from '@/lib/chart/render-viz-image';
import type { VizSettings, VizEnvelope } from '@/lib/validation/atlas-schemas';
import {
  BaseExecuteQuery,
  BaseSearchDBSchema,
  ExecuteQueryParamsNoTimeout,
  EXECUTE_QUERY_DESCRIPTION,
} from './db-tools';
import { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';
import { validateSemanticQuery, compileSemanticQuery, SemanticCompileError } from '@/lib/semantic/compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { resolveViewsInSql } from '@/lib/views/resolve';
import { resolveViewsForContext } from '@/lib/views/views.server';
import { loadNearestContext, resolveModelsForContext } from '@/lib/semantic/models.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { connectionTypeToDialect } from '@/lib/types';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { ContextContent } from '@/lib/types';
import type { QueryIR } from '@/lib/sql/ir-types';

/**
 * Production ExecuteQuery variant. Overrides `_initialiseConnectors` to a
 * no-op (production context carries no embedded connector configs) and
 * routes the fallback through `runQuery`, which goes via
 * `ConnectionsAPI.getRawByName` + `getNodeConnector` — the standard
 * production seam.
 *
 * Overrides `static schema` with the no-`timeout` variant: the production
 * path (`_executeFallback` → `runQuery`) does not yet honour the query
 * timeout, so the param + its description are hidden here rather than
 * advertising a capability the production tool doesn't deliver. Wiring
 * the timeout through the production path is tracked in Tasks.md; restore
 * the full schema once that lands. `schema.name` is unchanged, so the LLM
 * still sees one consistent tool name.
 */
export class ExecuteQuery extends BaseExecuteQuery {
  static override readonly schema: Tool<TSchema> = {
    name: 'ExecuteQuery',
    description: EXECUTE_QUERY_DESCRIPTION,
    parameters: ExecuteQueryParamsNoTimeout,
  };

  protected override async _initialiseConnectors(): Promise<void> {
    // No-op: production context.connections is metadata-only (no `config`).
    // Query execution goes through `runQuery` via the fallback hook below.
  }

  protected override async _executeFallback(
    connectionId: string,
    query: string,
    params: Record<string, string | number>,
  ): Promise<QueryResult> {
    const user = (this.context as { effectiveUser?: EffectiveUser }).effectiveUser;
    if (!user) {
      throw new Error(
        'ExecuteQuery: missing effectiveUser on agent context — cannot resolve connection. This is a server bug; please report.',
      );
    }
    // Route through the SHARED durable cache (arch doc §5): an agent query and a
    // UI query of the same SQL+params in the same mode hit one blob + SWR. The
    // cache is best-effort, so a DB/blob hiccup degrades to direct execution.
    //
    // Read the result BOUNDED: the agent truncates row data to a character budget anyway, so we
    // only materialize enough rows to fill it (peak RAM = AGENT_DRAIN_MAX_BYTES, not the full
    // result). The blob still holds/streams the FULL set, and meta.rowCount is the true total.
    const { result } = await getCachedResultBounded({
      mode: user.mode,
      connectionName: connectionId,
      query,
      params: params as Record<string, string | number | null>,
      policy: resolveCachePolicy(null),
      // The execute thunk streams; the write-through avoids a second server-side copy. Its own
      // (uncached-degrade) drain is bounded inside getCachedResultBounded.
      execute: async () => runQueryStream(connectionId, query, params, user),
    }, { maxBytes: AGENT_DRAIN_MAX_BYTES, maxRows: AGENT_DRAIN_MAX_ROWS });
    return result;
  }

  /** Server-side ECharts-SSR → JPEG render of the result viz (used when rawData is off). */
  protected override async _renderVizJpeg(
    queryResult: QueryResult,
    vizSettings: unknown,
  ): Promise<Buffer | null> {
    try {
      return await renderChartToJpeg(queryResult, vizSettings as VizSettings, { width: 512, colorMode: 'dark' });
    } catch {
      return null; // fall back to row data on any render failure
    }
  }

  /** Server-side Vega envelope → JPEG render of the result viz (the V2 path). */
  protected override async _renderVizEnvelopeJpeg(
    queryResult: QueryResult,
    viz: VizEnvelope,
  ): Promise<Buffer | null> {
    try {
      return await renderVizEnvelopeToJpeg(viz, queryResult.rows, { width: 512, colorMode: 'dark' });
    } catch {
      return null; // fall back to row data on any render failure
    }
  }
}

/**
 * Production SearchDBSchema variant. Overrides `_initialiseConnectors` to
 * a no-op and routes the schema fallback through `loadConnectionSchema`,
 * which reads the cached schema from the connection file via FilesAPI.
 * Inherits `static schema` (and therefore `schema.name`) from
 * `BaseSearchDBSchema`.
 */
export class SearchDBSchema extends BaseSearchDBSchema {
  protected override async _initialiseConnectors(): Promise<void> {
    // No-op: production never uses embedded connectors.
  }

  protected override async _loadSchemaFallback(connection: string): Promise<SchemaEntry[]> {
    const user = (this.context as { effectiveUser?: EffectiveUser }).effectiveUser;
    if (!user) return [];
    return loadConnectionSchema(connection, user);
  }
}

/**
 * Production FuzzyMatch tool.
 * execution shares `executeFuzzyMatch` with the v1 Next.js handler so v1 and v2
 * behave identically. `semantic_expansion` is advertised for schema parity but
 * not acted on (matching the v1 handler, which runs a single fuzzy match).
 */
const FuzzyMatchParams = Type.Object({
  connection_id: Type.String({ description: 'Database connection name' }),
  table: Type.String({ description: 'Table name to search' }),
  column: Type.String({ description: 'Text column to search in' }),
  search_term: Type.String({ description: 'Short keyword(s) to fuzzy-match. Use 1-3 specific words, not full phrases.' }),
  schema: Type.Optional(Type.String({ description: "Schema name (default: 'main')" })),
  limit: Type.Optional(Type.Number({ description: 'Max results to return' })),
  semantic_expansion: Type.Optional(Type.Boolean({ description: 'Automatically expand search using semantically similar terms found in the column (default: true). Set to false for pure lexical matching only.' })),
  return_columns: Type.Optional(Type.Array(Type.String(), { description: "Additional columns to include in each match result for identification (e.g. ['name', 'id']). Without this, only the matched column value and similarity score are returned." })),
});

export class FuzzyMatch extends MXTool<typeof FuzzyMatchParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof FuzzyMatchParams> = {
    name: 'FuzzyMatch',
    description:
      'Match a known term against stored values in a text or categorical column.\n\n' +
      'Use 1-3 short, specific keywords. Returns similarity-based and substring matches. ' +
      'Use return_columns to include identifying columns (e.g. name, id) in results — without it, ' +
      'only the matched column value and similarity are returned. When semantic_expansion is enabled ' +
      '(default: true), if no lexical matches are found, the tool automatically finds semantically ' +
      'similar terms in the column and fuzzy-matches those too.\n\n' +
      'Example: user says "Hello World" but column stores "HelloWooorld".',
    parameters: FuzzyMatchParams,
  };

  async run(): Promise<ToolResponse> {
    const user = this.context.effectiveUser;
    if (!user) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'FuzzyMatch: missing effectiveUser on agent context.' }) }],
        isError: true,
      };
    }
    try {
      const result = await executeFuzzyMatch({ ...this.parameters }, user);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: result.success === false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }) }],
        isError: true,
      };
    }
  }
}

/**
 * RunSemanticQuery — query an AUTHORED semantic model by name instead of
 * writing SQL. Params reuse the SemanticQuerySpec shape (measures/dimensions/
 * filters/timeGrain/timeColumn/limit — see lib/validation/atlas-schemas.ts);
 * the spec is validated (`validateSemanticQuery` issues come back as a tool
 * error so the agent can self-correct), compiled to dialect SQL
 * (`compileSemanticQuery` → `irToSqlLocal`), view refs inlined
 * (`resolveViewsInSql`), and then EXECUTED BY DELEGATING to the production
 * `ExecuteQuery` above — same runQueryStream-through-durable-cache path, same
 * result shaping/truncation, same payload (`finalQuery` carries the compiled
 * SQL), so chat display works identically.
 *
 * Model resolution mirrors POST /api/semantic-models: nearest context for the
 * user's home folder (`loadNearestContext`), authored models = inherited
 * `fullSemanticModels` + the user-visible published version's own
 * (`resolveModelsForContext`).
 */
const RunSemanticQueryParams = Type.Object({
  model: Type.String({ description: 'Name of the authored semantic model to query (case-insensitive).' }),
  ...Type.Pick(SemanticQuerySpec, ['metrics']).properties,
  ...Type.Partial(Type.Pick(SemanticQuerySpec, ['dimensions', 'filters', 'timeGrain', 'timeColumn', 'limit'])).properties,
});

export class RunSemanticQuery extends MXTool<typeof RunSemanticQueryParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof RunSemanticQueryParams> = {
    name: 'RunSemanticQuery',
    description:
      'Run a query against an AUTHORED SEMANTIC MODEL by name — pick metrics and dimensions ' +
      'from the model instead of writing SQL. Optional filters (dimension/operator/value), timeGrain ' +
      '(with timeColumn to override the model\'s default time axis), and limit. The spec is validated ' +
      'against the model (errors list the exact issues — fix and retry), compiled to dialect SQL, and ' +
      'executed exactly like ExecuteQuery. Returns the same JSON payload as ExecuteQuery (data as GFM ' +
      'markdown, totalRows, shownRows, columns, types) with finalQuery = the compiled SQL. An unknown ' +
      'model name returns the list of available model names.',
    parameters: RunSemanticQueryParams,
  };

  async run(): Promise<ToolResponse> {
    const fail = (error: string): ToolResponse => ({
      content: [{ type: 'text', text: JSON.stringify({ success: false, error }) }],
      isError: true,
    });

    const user = this.context.effectiveUser;
    if (!user) {
      return fail('RunSemanticQuery: missing effectiveUser on agent context — cannot resolve the semantic model. This is a server bug; please report.');
    }

    // Nearest context for the user's home folder — the same anchor chat uses.
    const basePath = this.context.homeFolder ?? resolveHomeFolderSync(user.mode, user.home_folder || '');
    let contextContent: ContextContent | null = null;
    try {
      contextContent = await loadNearestContext(user, basePath);
    } catch {
      contextContent = null;
    }

    const models = resolveModelsForContext(contextContent, user.userId);
    const requested = this.parameters.model;
    const model = models.find((m) => m.name.toLowerCase() === requested.toLowerCase());
    if (!model) {
      const available = models.map((m) => m.name).join(', ') || '(none)';
      return fail(`Unknown semantic model "${requested}". Available models: ${available}.`);
    }

    const spec: SemanticQuerySpec = {
      model: model.name,
      table: null,
      schema: null,
      metrics: this.parameters.metrics,
      dimensions: this.parameters.dimensions ?? [],
      filters: this.parameters.filters ?? null,
      timeGrain: this.parameters.timeGrain ?? null,
      timeColumn: this.parameters.timeColumn ?? null,
      limit: this.parameters.limit ?? null,
    };

    const issues = validateSemanticQuery(spec, model);
    if (issues.length > 0) {
      return fail(`Invalid semantic query for model "${model.name}": ${issues.join('; ')}`);
    }

    let sql: string;
    try {
      const ir = compileSemanticQuery(spec, model) as QueryIR;
      const dialect = await this._dialectFor(model.connection, user.mode);
      const rawSql = irToSqlLocal(ir, dialect);
      const views = resolveViewsForContext(contextContent, user.userId)
        .filter((v) => v.connection === model.connection);
      sql = await resolveViewsInSql(rawSql, dialect, views as never);
    } catch (err) {
      const detail = err instanceof SemanticCompileError
        ? err.issues.join('; ')
        : (err instanceof Error ? err.message : String(err));
      return fail(`Failed to compile semantic query for model "${model.name}": ${detail}`);
    }

    // Execute EXACTLY like ExecuteQuery (same tool, same run()) — shared durable
    // cache, same truncation, same payload shape; finalQuery = the compiled SQL.
    const exec = new ExecuteQuery(
      this.orchestrator,
      { connectionId: model.connection, query: sql },
      this.context,
      this.id,
    );
    return exec.run();
  }

  /** Connection dialect (same seam as the semantic save gate); duckdb fallback. */
  private async _dialectFor(connection: string, mode: EffectiveUser['mode']): Promise<string> {
    try {
      const { type } = await ConnectionsAPI.getRawByName(connection, mode);
      return connectionTypeToDialect(type);
    } catch {
      return 'duckdb';
    }
  }
}
