// Per-dialect random-row sampling for catalog build. Uses each engine's
// native sampling syntax so we don't full-scan multi-GB tables just to pick
// 100 rows. Pure: returns the raw query string (or stringified Mongo
// pipeline JSON) — the catalog builder hands it to `connector.query`.
//
// Strategies:
// - duckdb / sqlite (benchmark-sqlite routes through DuckDB):
//     SELECT * FROM "<table>" USING SAMPLE <n> ROWS
//   `USING SAMPLE n ROWS` is DuckDB's reservoir sampler — bounded memory,
//   doesn't full-scan, deterministic-ish under a fixed seed.
// - postgresql: TABLESAMPLE BERNOULLI(1) LIMIT n
//   Reads ~1% of pages and stops at n rows. Cheaper than ORDER BY RANDOM().
// - bigquery: TABLESAMPLE SYSTEM (1 PERCENT) LIMIT n
//   Block-level sampler; lowest-cost option there.
// - mongo: {$sample: {size: n}} as the first pipeline stage
//   Uses storage-engine $sampleFromRandomCursor when n < 5% of collection.
// - fallback: ORDER BY RANDOM() LIMIT n (correct but slow on large tables)
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
      return `SELECT * FROM ${qualifiedSql} TABLESAMPLE BERNOULLI(1) LIMIT ${n}`;

    case 'bigquery': {
      // BigQuery uses backticks and dotted dataset.table syntax (no quotes).
      const ref = schema ? `\`${schema}.${table}\`` : `\`${table}\``;
      return `SELECT * FROM ${ref} TABLESAMPLE SYSTEM (1 PERCENT) LIMIT ${n}`;
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
