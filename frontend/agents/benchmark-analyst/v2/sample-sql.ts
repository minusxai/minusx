// Per-dialect random-row sampling for catalog build. Returns a query
// string (or stringified Mongo pipeline JSON) that fetches up to N random
// rows for a table. Pure: the catalog builder hands the output to
// `connector.query`.
//
// Strategies are chosen so that **a table with K < N rows still returns
// min(K, N) rows**, not zero. Earlier versions used percentage-based
// samplers (`TABLESAMPLE BERNOULLI(1)`, `TABLESAMPLE SYSTEM (1 PERCENT)`)
// which silently returned 0–1 rows on small tables and silently degraded
// the lighter-model orientation pass (it had nothing to look at).
//
// - duckdb / sqlite (benchmark-sqlite routes through DuckDB):
//     SELECT * FROM "<table>" USING SAMPLE <n> ROWS
//   DuckDB's `USING SAMPLE n ROWS` is a reservoir sampler — bounded
//   memory AND returns min(K, N) for K < N. Already-correct.
// - postgresql / bigquery / fallback: `ORDER BY RANDOM() LIMIT n`
//   (`ORDER BY RAND()` for BigQuery — different keyword). Slow on huge
//   tables (full sort), but benchmark tables are small and the engine
//   short-circuits LIMIT. Correctness > speed here.
// - mongo: `{$sample: {size: n}}` — already correct for any collection
//   size (returns min(count, n)).
//
// Identifier escaping is conservative — we quote every identifier even
// though most are simple — matches how the rest of catalog.ts builds SQL.

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Build the random-sample query/pipeline string for a single table. */
export function buildSampleSql(
  dialect: string,
  schema: string | null | undefined,
  table: string,
  n: number,
): string {
  const qualifiedSql = schema && schema !== 'main' && schema !== ''
    ? `${quoteIdent(schema)}.${quoteIdent(table)}`
    : quoteIdent(table);

  switch (dialect) {
    case 'duckdb':
    case 'sqlite':
      return `SELECT * FROM ${qualifiedSql} USING SAMPLE ${n} ROWS`;

    case 'postgresql':
      return `SELECT * FROM ${qualifiedSql} ORDER BY RANDOM() LIMIT ${n}`;

    case 'bigquery': {
      // BigQuery uses backticks and dotted dataset.table syntax (no quotes).
      // BigQuery's random function is RAND() (not RANDOM()).
      const ref = schema ? `\`${schema}.${table}\`` : `\`${table}\``;
      return `SELECT * FROM ${ref} ORDER BY RAND() LIMIT ${n}`;
    }

    case 'mongo':
      // The Mongo connector accepts `{collection, pipeline}` JSON.
      return JSON.stringify({
        collection: table,
        pipeline: [{ $sample: { size: n } }],
      });

    default:
      return `SELECT * FROM ${qualifiedSql} ORDER BY RANDOM() LIMIT ${n}`;
  }
}
