// ExploreV2: Cross-table discovery search
// "Search when you don't know the table" — lexical matching with optional semantic re-ranking

import { Type, type Tool } from '@mariozechner/pi-ai';
import type { DuckDBConnection } from '@duckdb/node-api';
import { type ToolResponse } from '@/orchestrator/types';
import type { NodeConnector, QueryResult } from '@/lib/connections/base';
import { storeHandle } from './handle-store';
import { computeResultStats } from './result-stats';
import { getCatalogStore } from './catalog';
import { V2DataTool, getLighterModel } from './data-tool-base';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import type { ResultEntry } from '../result-shapes';

const ExploreFilter = Type.Object({
  connection: Type.Optional(Type.String({ description: 'Limit search to this connection' })),
  schema: Type.Optional(Type.String({ description: 'Limit search to this schema' })),
  table: Type.Optional(Type.String({ description: 'Limit search to this table' })),
  columns: Type.Optional(Type.Array(Type.String(), { description: 'Limit search to these columns' })),
  match: Type.Optional(Type.String({
    description: 'Term to search for (lexical/fuzzy matching). Omit for sampling/clustering use cases — without a match filter Explore samples rows from in-scope text columns; combine with a `prompt` to have the lighter model pick the most diverse / cluster them / etc.',
  })),
});

const ExploreParams = Type.Object({
  filter: ExploreFilter,
  prompt: Type.Optional(Type.String({ description: 'Optional: if provided, an LLM re-ranks/filters results semantically' })),
});


interface ExploreDetails {
  connectionsSearched: number;
  tablesSearched: number;
  rowsFound: number;
}

interface SearchTarget {
  connection: string;
  schema: string;
  table: string;
  column: string;
  dialect: string;
}

export class ExploreV2 extends V2DataTool<typeof ExploreParams, ExploreDetails> {
  static readonly schema: Tool<typeof ExploreParams> = {
    name: 'Explore',
    description: `Find ROWS matching a term/value across one or many tables — the discovery tool. Use Explore when you're searching for *where* something is, before you know its exact location.

USE EXPLORE WHEN:
- You need to find which rows mention a value, and you're not sure which table/column has it (e.g. "find all businesses with 'vegan' in any text field").
- You want fuzzy matching across many text columns at once — Explore runs the right per-dialect search automatically (see each connection's per-dialect notes for which fuzzy functions are available).
- You want semantic narrowing of lexical hits — pass a \`prompt\` and the lighter model re-ranks/filters by meaning ("rank by relevance to clean energy"). The re-rank is best-effort.
- You want to SAMPLE / cluster / pick-diverse rows across text columns — omit \`match\` (no WHERE filter) and pass a \`prompt\` like "pick the 10 most diverse business names" or "cluster these articles by topic, return cluster labels in info".

DO NOT use Explore when you already know the exact table/column and need a precise aggregate, join, or filter — use ExecuteQuery for that.

FILTER:
- match (optional): the term to find. Per-dialect lexical/fuzzy match. **Omit for sampling/clustering** — combined with \`prompt\`, the lighter model picks diverse rows / clusters from the sampled set.
- connection / schema / table / columns: scope to a subset. Omit for broad search.

OUTPUT: {results: [{preview, handle, stats}], info?}. Each row is {id, matched_text, source, score} where \`source\` is "table.column" — tells you exactly where the hit came from. Use that to identify the right place, then ExecuteQuery to drill in.

WORKS ACROSS DIALECTS: each connector uses its native lexical/fuzzy primitives — see the per-dialect hints for specifics.

Examples:
- Where does "amy jones" appear? \`{filter: {match: "amy jones"}}\`
- Vegan options in the catalog: \`{filter: {connection: "catalog_db", columns: ["name", "description"], match: "vegan"}}\`
- Energy products, ranked semantically: \`{filter: {match: "energy"}, prompt: "rank by relevance to renewable energy"}\``,
    parameters: ExploreParams,
  };

  async run(): Promise<ToolResponse<ExploreDetails>> {
    const { filter, prompt } = this.parameters;

    await this.ensureConnectors();

    // Validate connection filter if provided
    if (filter.connection && !this.connectors.has(filter.connection)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Connection '${filter.connection}' not found. Available: ${Array.from(this.connectors.keys()).join(', ')}` }),
        }],
        isError: true,
        details: { connectionsSearched: 0, tablesSearched: 0, rowsFound: 0 },
      };
    }

    // Resolve in-scope text columns by querying the catalog (shared with
    // SearchDBSchema). Uses `column_stats.category` where available; falls
    // back to a type-name heuristic for columns without stats. The
    // `sampleConfig`/`catalogKey` plumbing matches SearchDBSchema so
    // hitting Explore first vs SearchDBSchema first doesn't change which
    // catalog instance the sub-agent ends up bound to.
    const { conn: catalogConn } = await getCatalogStore(
      this.context.connections,
      this.catalogKey(),
      this.buildSampleConfig(),
      this.context.datasetKey,
    );
    const targets = await this.findSearchTargets(filter, catalogConn);

    // Run per-target searches in parallel — each is an independent query
    // against its target connection. A per-target failure (e.g. SQL syntax
    // mismatch on an unusual dialect) is logged and produces empty rows for
    // that target rather than failing the whole search.
    const searchedConnections = new Set<string>();
    const searchedTables = new Set<string>();
    const perTarget = await Promise.all(
      targets.map(async (target) => {
        searchedConnections.add(target.connection);
        searchedTables.add(`${target.connection}.${target.table}`);
        try {
          return await this.searchColumn(target, filter.match);
        } catch (err) {
          console.warn(
            `Search failed for ${target.connection}.${target.table}.${target.column}:`,
            err,
          );
          return [] as Record<string, unknown>[];
        }
      }),
    );
    const allRows: Record<string, unknown>[] = perTarget.flat();

    // Sort by score descending
    allRows.sort((a, b) => (b.score as number) - (a.score as number));

    // Build result
    const result: QueryResult = {
      columns: ['id', 'matched_text', 'source', 'score'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'DOUBLE'],
      rows: allRows.slice(0, 1000), // Cap at 1000 results
      finalQuery: filter.match ? `EXPLORE match="${filter.match}"` : `EXPLORE (sampling, no match filter)`,
    };

    const stored = await storeHandle(result);
    const stats = computeResultStats(result, Math.min(result.rows.length, 100));

    // With a prompt, the lighter model re-ranks the search hits and writes one
    // `info` summary (see prompt-pass.ts). Skip the inline compress in that
    // path — `runPromptPass` builds the preview from the (re-ranked) rows.
    let preview: string;
    let info: string | undefined;
    if (prompt && result.rows.length > 0) {
      const pass = await this.runPromptPass(
        [{ label: `Search: "${filter.match ?? '(no match filter)'}"`, result }],
        prompt,
        getLighterModel(),
      );
      preview = pass.previews[0] ?? compressQueryResult(result, TOOL_MAX_LIMIT_CHARS).data;
      info = pass.info;
    } else {
      preview = compressQueryResult(result, TOOL_MAX_LIMIT_CHARS).data;
    }

    const entry: ResultEntry = stored.error
      ? { preview, stats, handle_error: stored.error }
      : { preview, handle: stored.handleId, stats };
    const response: { results: ResultEntry[]; info?: string } = {
      results: [entry],
      ...(info !== undefined ? { info } : {}),
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: false,
      details: {
        connectionsSearched: searchedConnections.size,
        tablesSearched: searchedTables.size,
        rowsFound: result.rows.length,
      },
    };
  }

  private async findSearchTargets(
    filter: {
      connection?: string;
      schema?: string;
      table?: string;
      columns?: string[];
      match?: string;
    },
    catalogConn: DuckDBConnection,
  ): Promise<SearchTarget[]> {
    const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const where: string[] = [];
    if (filter.connection) where.push(`c.connection_name = ${lit(filter.connection)}`);
    if (filter.schema) where.push(`c.schema_name = ${lit(filter.schema)}`);
    if (filter.table) where.push(`c.table_name = ${lit(filter.table)}`);
    if (filter.columns && filter.columns.length > 0) {
      where.push(`c.column_name IN (${filter.columns.map(lit).join(', ')})`);
    }
    // Prefer the proper category classification from `column_stats`; fall back
    // to a type-name heuristic when stats are absent (unprofiled connectors).
    where.push(`(
      cs.category IN ('text', 'categorical')
      OR (cs.category IS NULL AND (
        UPPER(c.data_type) LIKE '%VARCHAR%'
        OR UPPER(c.data_type) LIKE '%TEXT%'
        OR UPPER(c.data_type) LIKE '%CHAR%'
        OR UPPER(c.data_type) LIKE '%STRING%'
      ))
    )`);

    const sql = `
      SELECT c.connection_name, c.schema_name, c.table_name, c.column_name
      FROM columns c
      LEFT JOIN column_stats cs
        ON cs.connection_name = c.connection_name
        AND cs.schema_name = c.schema_name
        AND cs.table_name = c.table_name
        AND cs.column_name = c.column_name
      WHERE ${where.join(' AND ')}
    `;

    const result = await catalogConn.run(sql);
    const rows = (await result.getRowObjectsJS()) as Array<{
      connection_name: string;
      schema_name: string;
      table_name: string;
      column_name: string;
    }>;
    return rows.map((r) => ({
      connection: r.connection_name,
      schema: r.schema_name,
      table: r.table_name,
      column: r.column_name,
      dialect: this.dialects.get(r.connection_name) ?? 'duckdb',
    }));
  }

  private async searchColumn(
    target: SearchTarget,
    match: string | undefined,
  ): Promise<Record<string, unknown>[]> {
    const connector = this.connectors.get(target.connection);
    if (!connector) return [];

    // Mongo: SQL doesn't apply — use a native aggregation pipeline.
    if (target.dialect === 'mongo') {
      return this.searchMongoColumn(connector, target, match);
    }

    // Postgres: try pg_trgm `similarity()` first; fall back to LIKE-only if
    // the extension isn't installed.
    if (target.dialect === 'postgresql') {
      return this.searchPostgresColumn(connector, target, match);
    }

    // DuckDB and benchmark sqlite (which routes through the shared DuckDB
    // instance — see shared-duckdb.ts) both support `jaro_winkler_similarity`.
    const isDuckdbBacked = target.dialect === 'duckdb' || target.dialect === 'sqlite';
    const source = `${target.table}.${target.column}`;

    // No match → sampling mode (no WHERE filter; just project non-null rows).
    if (!match) {
      const sql = buildSamplingSql(target, source);
      try {
        return (await connector.query(sql)).rows;
      } catch {
        return [];
      }
    }

    const escapedMatch = match.replace(/'/g, "''");
    const sql = isDuckdbBacked
      ? buildJaroWinklerSql(target, source, escapedMatch)
      : buildGenericLikeSql(target, source, escapedMatch);

    try {
      const result = await connector.query(sql);
      return result.rows;
    } catch {
      // Fallback: simplest possible LIKE-only query without rowid (covers
      // dialects where the original SQL had a quirk).
      const fallbackSql = `
        SELECT
          "${target.column}" as matched_text,
          '${source}' as source,
          0.8 as score
        FROM "${target.table}"
        WHERE "${target.column}" IS NOT NULL
          AND LOWER("${target.column}") LIKE LOWER('%${escapedMatch}%')
        LIMIT 100
      `;
      try {
        const result = await connector.query(fallbackSql);
        return result.rows.map((row, i) => ({ id: String(i), ...row }));
      } catch {
        return [];
      }
    }
  }

  /**
   * Mongo search: native aggregation pipeline. `$regex` with case-insensitive
   * flag is the closest analog to lexical fuzzy match — Mongo has no built-in
   * jaro_winkler / similarity. Special characters in the search term are
   * regex-escaped. Output is projected to the standard
   * `{id, matched_text, source, score}` shape so the union with SQL targets
   * is uniform.
   */
  private async searchMongoColumn(
    connector: NodeConnector,
    target: SearchTarget,
    match: string | undefined,
  ): Promise<Record<string, unknown>[]> {
    // No match → sampling: just project non-null rows from the collection.
    const matchStage = match
      ? { $match: { [target.column]: { $regex: match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } }
      : { $match: { [target.column]: { $exists: true, $ne: null } } };

    const pipeline = [
      matchStage,
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          matched_text: { $toString: `$${target.column}` },
          source: { $literal: `${target.table}.${target.column}` },
          score: { $literal: 1.0 },
        },
      },
      { $limit: 100 },
    ];
    const queryStr = JSON.stringify({ collection: target.table, pipeline });
    try {
      const result = await connector.query(queryStr);
      return result.rows;
    } catch {
      return [];
    }
  }

  /**
   * Postgres search: try pg_trgm's `similarity()` (real fuzzy) + ILIKE; on
   * any error (most commonly the extension not being installed), fall back to
   * an ILIKE-only query so we still surface lexical matches.
   */
  private async searchPostgresColumn(
    connector: NodeConnector,
    target: SearchTarget,
    match: string | undefined,
  ): Promise<Record<string, unknown>[]> {
    const source = `${target.table}.${target.column}`;
    const schemaTable = `"${target.schema}"."${target.table}"`;

    // No match → sampling: just project non-null rows.
    if (!match) {
      const sql = `
        SELECT
          ctid::text as id,
          "${target.column}" as matched_text,
          '${source}' as source,
          1.0 as score
        FROM ${schemaTable}
        WHERE "${target.column}" IS NOT NULL
        LIMIT 100
      `;
      try {
        return (await connector.query(sql)).rows;
      } catch {
        return [];
      }
    }

    const escapedMatch = match.replace(/'/g, "''");
    const fuzzySql = `
      SELECT
        ctid::text as id,
        "${target.column}" as matched_text,
        '${source}' as source,
        similarity("${target.column}", '${escapedMatch}') as score
      FROM ${schemaTable}
      WHERE "${target.column}" IS NOT NULL
        AND (
          "${target.column}" ILIKE '%${escapedMatch}%'
          OR similarity("${target.column}", '${escapedMatch}') > 0.3
        )
      ORDER BY score DESC
      LIMIT 100
    `;
    try {
      const result = await connector.query(fuzzySql);
      return result.rows;
    } catch {
      // pg_trgm probably absent — try LIKE-only.
      const likeSql = `
        SELECT
          ctid::text as id,
          "${target.column}" as matched_text,
          '${source}' as source,
          CASE
            WHEN LOWER("${target.column}") = LOWER('${escapedMatch}') THEN 1.0
            WHEN "${target.column}" ILIKE '%${escapedMatch}%' THEN 0.8
            ELSE 0.5
          END as score
        FROM ${schemaTable}
        WHERE "${target.column}" IS NOT NULL
          AND "${target.column}" ILIKE '%${escapedMatch}%'
        ORDER BY score DESC
        LIMIT 100
      `;
      try {
        const result = await connector.query(likeSql);
        return result.rows;
      } catch {
        return [];
      }
    }
  }
}

// ─── Per-dialect SQL builders ─────────────────────────────────────────────

function buildJaroWinklerSql(target: SearchTarget, source: string, escapedMatch: string): string {
  return `
    SELECT
      rowid as id,
      "${target.column}" as matched_text,
      '${source}' as source,
      jaro_winkler_similarity("${target.column}", '${escapedMatch}') as score
    FROM "${target.table}"
    WHERE "${target.column}" IS NOT NULL
      AND (
        "${target.column}" ILIKE '%${escapedMatch}%'
        OR jaro_winkler_similarity("${target.column}", '${escapedMatch}') > 0.7
      )
    ORDER BY score DESC
    LIMIT 100
  `;
}

/** No-match (sampling) SQL — for DuckDB / benchmark-sqlite / generic. Just
 *  projects non-null rows so the prompt-pass model can pick diverse / cluster. */
function buildSamplingSql(target: SearchTarget, source: string): string {
  return `
    SELECT
      CAST(rowid AS VARCHAR) as id,
      "${target.column}" as matched_text,
      '${source}' as source,
      1.0 as score
    FROM "${target.table}"
    WHERE "${target.column}" IS NOT NULL
    LIMIT 100
  `;
}

function buildGenericLikeSql(target: SearchTarget, source: string, escapedMatch: string): string {
  return `
    SELECT
      CAST(rowid AS VARCHAR) as id,
      "${target.column}" as matched_text,
      '${source}' as source,
      CASE
        WHEN LOWER("${target.column}") = LOWER('${escapedMatch}') THEN 1.0
        WHEN LOWER("${target.column}") LIKE LOWER('%${escapedMatch}%') THEN 0.8
        ELSE 0.5
      END as score
    FROM "${target.table}"
    WHERE "${target.column}" IS NOT NULL
      AND LOWER("${target.column}") LIKE LOWER('%${escapedMatch}%')
    ORDER BY score DESC
    LIMIT 100
  `;
}
