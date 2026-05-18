import 'server-only';

import type { ColumnMeta, NodeConnector } from '@/lib/connections/base';
import type { Api, Model } from '@/lib/llm/get-model';
import type { ConnectionInfo } from '../../types';
import { getOrCreateBenchmarkConnector } from '../../shared-duckdb';
import { getCatalogStore, type CatalogTables } from '../catalog';
import {
  type PromptPassCallLLM,
  type PromptPassContext,
  extractText,
} from '../prompt-pass';
import { getLighterModel } from '../data-tool-base';
import { flattenCatalogColumns, type FlatColumn } from './schema';
import {
  getRshipsNStructure,
  type RshipsDeps,
} from './rships';
import { generateTableNotes } from './notes';
import { generateExamples } from './examples';
import { renderAutoContext } from './format';
import { fetchTableSample } from './samples';

// ─── Filter step: LLM picks relevant tables given a question ────────────────

const FILTER_SYSTEM_PROMPT = `You select tables from a database catalog that are relevant to a user's question.

Given the schema (table names + column types) and the question, return a JSON
array of the table identifiers most relevant to the question. Use the literal
form "<connection>.<schema>.<table>" exactly as shown.

- Include tables whose names or columns match concepts in the question.
- Include tables joined to those (the agent will need them too).
- Exclude tables that are obviously unrelated.

Respond with ONLY a JSON array of strings — no prose, no code fences:
["conn.schema.table_a","conn.schema.table_b", ...]`;

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

/** Defensive parse of the filter LLM's JSON array. Returns an empty set on
 *  parse failure or non-array input. */
export function parseFilterResponse(text: string): Set<string> {
  try {
    const raw = JSON.parse(stripFences(text));
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((s): s is string => typeof s === 'string'));
  } catch {
    return new Set();
  }
}

/** Render the schema in a terse table+columns form for the filter prompt. */
function renderSchemaForFilter(schema: FlatColumn[]): string {
  const byTable = new Map<string, string[]>();
  for (const c of schema) {
    const id = `${c.connection}.${c.schema}.${c.table}`;
    let cols = byTable.get(id);
    if (!cols) { cols = []; byTable.set(id, cols); }
    cols.push(`${c.column}:${c.type}`);
  }
  return [...byTable.entries()].map(([id, cols]) => `${id} — ${cols.join(', ')}`).join('\n');
}

/** Ask the lighter model which tables are relevant to the user's question. */
export async function filterSchemaByQuestion(
  schema: FlatColumn[],
  userMessage: string,
  llmContext: PromptPassContext,
  model: Model<Api>,
  callLLM: PromptPassCallLLM,
): Promise<Set<string>> {
  const userContent = [
    `## Original question\n${userMessage}`,
    llmContext.contextDocs ? `## Data Documentation\n${llmContext.contextDocs}` : null,
    `## Schema\n${renderSchemaForFilter(schema)}`,
    `## Task\nReturn JSON array of relevant table identifiers per the system rules.`,
  ].filter(Boolean).join('\n\n');

  const text = extractText(
    await callLLM(model, {
      systemPrompt: FILTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent, timestamp: Date.now() }],
      tools: [],
    }),
  );
  return parseFilterResponse(text);
}

// ─── Catalog → stats + row counts maps ───────────────────────────────────────

function buildStatsMap(catalog: CatalogTables): Map<string, ColumnMeta> {
  const out = new Map<string, ColumnMeta>();
  for (const r of catalog.column_stats.rows) {
    const key = `${r.connection_name}.${r.schema_name}.${r.table_name}.${r.column_name}`;
    const meta: ColumnMeta = {};
    if (typeof r.category === 'string') meta.category = r.category as ColumnMeta['category'];
    if (typeof r.n_distinct === 'number' || typeof r.n_distinct === 'bigint') meta.nDistinct = Number(r.n_distinct);
    if (typeof r.null_count === 'number' || typeof r.null_count === 'bigint') meta.nullCount = Number(r.null_count);
    if (r.min_value != null) meta.min = r.min_value as number | string;
    if (r.max_value != null) meta.max = r.max_value as number | string;
    if (typeof r.avg_value === 'number') meta.avg = r.avg_value;
    if (typeof r.min_date === 'string') meta.minDate = r.min_date;
    if (typeof r.max_date === 'string') meta.maxDate = r.max_date;
    if (typeof r.top_values === 'string') {
      try { meta.topValues = JSON.parse(r.top_values); } catch { /* ignore malformed */ }
    }
    out.set(key, meta);
  }
  return out;
}

function buildRowCountMap(catalog: CatalogTables): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of catalog.tables.rows) {
    const id = `${r.connection_name}.${r.schema_name}.${r.table_name}`;
    if (typeof r.row_count === 'number' || typeof r.row_count === 'bigint') {
      out.set(id, Number(r.row_count));
    }
  }
  return out;
}

/** Look up the schema name from the catalog for a given connection. Mongo
 *  uses the database name, SQL connectors use 'main' / 'public' / etc. */
function schemaForConnection(catalog: CatalogTables, connection: string): string {
  for (const r of catalog.columns.rows) {
    if (r.connection_name === connection) return String(r.schema_name);
  }
  return 'main';
}

// ─── buildAutoContextFromCatalog: testable with a pre-built catalog ─────────

export interface BuildAutoContextOpts {
  connectorsByName: Map<string, NodeConnector>;
  dialectsByName: Map<string, string>;
  datasetKey: string;
  userMessage?: string;
  llmContext: PromptPassContext;
  model: Model<Api>;
  callLLM: PromptPassCallLLM;
  maxChars?: number;
}

/**
 * Build the AutoContext markdown block from a pre-built catalog + the
 * orchestrator's `callLLM` hook. Splitting this from the catalog
 * fetch keeps the function testable without a live DuckDB instance.
 */
export async function buildAutoContextFromCatalog(
  catalog: CatalogTables,
  opts: BuildAutoContextOpts,
): Promise<string> {
  const schema = flattenCatalogColumns(catalog);
  const statsByCol = buildStatsMap(catalog);
  const rowCountByTable = buildRowCountMap(catalog);
  const { connectorsByName, dialectsByName, model, callLLM } = opts;
  const llmContext = opts.llmContext;
  const maxChars = opts.maxChars ?? 100_000;

  // Per-column sample value fetcher — for join-overlap probes. Returns
  // distinct values up to a small cap.
  const fetchSampleValues = async (col: FlatColumn): Promise<unknown[]> => {
    const conn = connectorsByName.get(col.connection);
    if (!conn) return [];
    const dialect = dialectsByName.get(col.connection) ?? 'duckdb';
    try {
      if (dialect === 'mongo') {
        const query = JSON.stringify({
          collection: col.table,
          pipeline: [{ $group: { _id: `$${col.column}` } }, { $limit: 200 }],
        });
        const result = await conn.query(query);
        return result.rows.map((r) => r._id);
      }
      // SQL-style: DISTINCT … LIMIT 200, dialect-quoted identifiers.
      const q = dialect === 'bigquery' ? '`' : '"';
      const sql = `SELECT DISTINCT ${q}${col.column}${q} AS v FROM ${q}${col.schema}${q}.${q}${col.table}${q} LIMIT 200`;
      const result = await conn.query(sql);
      return result.rows.map((r) => r.v);
    } catch {
      return [];
    }
  };

  // Per-table row sample fetcher — reused for LLM notes prompting.
  const fetchTableSampleHelper = async (
    t: { connection: string; schema: string; table: string },
  ): Promise<Record<string, unknown>[]> => {
    const conn = connectorsByName.get(t.connection);
    if (!conn) return [];
    const dialect = dialectsByName.get(t.connection) ?? 'duckdb';
    // Find which columns are high-cardinality text on this table — they
    // benefit from length-stratified sampling.
    const highCardTextCols: string[] = [];
    const colsForTable = schema.filter(
      (c) => c.connection === t.connection && c.schema === t.schema && c.table === t.table,
    );
    for (const c of colsForTable) {
      const meta = statsByCol.get(`${t.connection}.${t.schema}.${t.table}.${c.column}`);
      if (meta?.category === 'text' && (meta.nDistinct ?? 0) > 50) highCardTextCols.push(c.column);
    }
    return fetchTableSample(conn, t.schema, t.table, dialect, highCardTextCols);
  };

  // Connection-routed query executor for example validation.
  const executeExampleQuery = async (
    connection: string,
    query: string,
  ): Promise<{ columns: string[]; types: string[]; rows: Record<string, unknown>[]; finalQuery: string }> => {
    const conn = connectorsByName.get(connection);
    if (!conn) throw new Error(`unknown connection: ${connection}`);
    return conn.query(query);
  };

  const deps: RshipsDeps = {
    fetchSampleValues,
    fetchTableSample: fetchTableSampleHelper,
    generateTableNotes: (input, runOpts) =>
      generateTableNotes(input, model, callLLM, llmContext, runOpts),
    generateExamples: (summary, findings, runOpts) =>
      generateExamples(summary, findings, model, callLLM, llmContext, executeExampleQuery, runOpts),
    filterSchemaByQuestion: (s, msg, ctx) =>
      filterSchemaByQuestion(s, msg, ctx, model, callLLM),
  };

  // Silence: schemaForConnection is reserved for future per-connection
  // namespace work but isn't used in the current renderer.
  void schemaForConnection;

  const result = await getRshipsNStructure(
    schema, statsByCol, rowCountByTable, dialectsByName, deps,
    {
      datasetKey: opts.datasetKey,
      userMessage: opts.userMessage,
      llmContext,
      maxChars,
    },
  );
  return renderAutoContext(result, maxChars);
}

// ─── Top-level: read catalog + build context (the agent's entry) ─────────────

/** Top-level entry called by `BenchmarkAnalystAgent.run()`. Builds (or
 *  reads from process-wide cache) the catalog for the agent's
 *  `ctx.connections`, then renders the AutoContext block. */
export async function buildAutoContext(
  connections: ConnectionInfo[] | undefined,
  llmContext: PromptPassContext,
  callLLM: PromptPassCallLLM,
  opts: { datasetKey?: string; userMessage?: string; maxChars?: number; model?: Model<Api> } = {},
): Promise<string> {
  const datasetKey = opts.datasetKey ?? 'default';

  // Wire up real connectors via shared-duckdb (reuses the V2 pool).
  const connectorsByName = new Map<string, NodeConnector>();
  const dialectsByName = new Map<string, string>();
  for (const entry of connections ?? []) {
    if (!entry.config) continue;
    const c = await getOrCreateBenchmarkConnector(
      entry.name, entry.dialect, entry.config, { datasetKey },
    );
    connectorsByName.set(entry.name, c);
    dialectsByName.set(entry.name, entry.dialect);
  }

  // Read the cached catalog (built lazily if needed). No sample-table
  // population — AutoContext fetches its own samples per the agent's
  // dataset shape.
  const { catalog } = await getCatalogStore(connections, 'default', undefined, datasetKey);

  return buildAutoContextFromCatalog(catalog, {
    connectorsByName,
    dialectsByName,
    datasetKey,
    userMessage: opts.userMessage,
    llmContext,
    model: opts.model ?? getLighterModel(),
    callLLM,
    maxChars: opts.maxChars,
  });
}
