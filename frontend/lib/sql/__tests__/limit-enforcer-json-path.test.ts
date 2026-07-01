/**
 * Regression: enforceQueryLimit must NOT mangle `$`-prefixed keys inside JSON
 * path string literals.
 *
 * Bug seen in production (BigQuery + PostHog): properties are stored with
 * `$`-prefixed keys (`$current_url`, `$browser`, `$os`). A query like
 *
 *   SELECT JSON_VALUE(t.properties, '$."$current_url"') AS current_url
 *   FROM `proj`.`posthog`.`events` AS t LIMIT 100;
 *
 * runs fine in the BigQuery console but returns every column NULL on the
 * platform. enforceQueryLimit regenerates the SQL and then runs a "restore
 * parameter placeholders" pass (`$param → :param`) that is blind to string
 * literals — it rewrites `$current_url` inside the JSON path to `:current_url`,
 * so JSON_VALUE looks up a key that does not exist and returns NULL for every
 * row.
 *
 * The string literal must survive regeneration untouched.
 */

import { enforceQueryLimit } from '../limit-enforcer';

describe('enforceQueryLimit — JSON path string literals with $-prefixed keys', () => {
  it('preserves $-prefixed JSON keys (PostHog properties) in BigQuery', async () => {
    const sql =
      `SELECT\n` +
      `  JSON_VALUE(t.properties, '$."$current_url"') AS current_url,\n` +
      `  JSON_VALUE(t.properties, '$."$browser"') AS browser,\n` +
      `  JSON_VALUE(t.properties, '$."$os"') AS os\n` +
      "FROM `minusx-cloud-storage-442902`.`posthog`.`events` AS t\n" +
      `LIMIT 100`;

    const out = await enforceQueryLimit(sql, { dialect: 'bigquery' });

    // The $-prefixed keys must still be addressed as `$key`, never `:key`/`@key`.
    expect(out).toContain('$current_url');
    expect(out).toContain('$browser');
    expect(out).toContain('$os');
    expect(out).not.toContain(':current_url');
    expect(out).not.toContain(':browser');
    expect(out).not.toContain(':os');
  });

  it('still restores genuine :param placeholders outside string literals', async () => {
    // polyglot rewrites `:max_rows` into the dialect-native `@max_rows` for
    // bigquery; the restore pass must turn it back into `:max_rows`.
    const sql = `SELECT id FROM events WHERE rows < :max_rows LIMIT 50`;

    const out = await enforceQueryLimit(sql, { dialect: 'bigquery' });

    expect(out).toContain(':max_rows');
    expect(out).not.toContain('@max_rows');
  });

  it('does not mangle a $-key even when a real :param is also present', async () => {
    const sql =
      `SELECT JSON_VALUE(t.properties, '$."$current_url"') AS url ` +
      `FROM events AS t WHERE t.ts > :start_date LIMIT 100`;

    const out = await enforceQueryLimit(sql, { dialect: 'bigquery' });

    expect(out).toContain('$current_url');
    expect(out).toContain(':start_date');
    expect(out).not.toContain(':current_url');
  });

  it('does not mangle an @ inside an email string literal', async () => {
    const sql = `SELECT id FROM users WHERE email = 'alice@example.com' LIMIT 10`;

    const out = await enforceQueryLimit(sql, { dialect: 'bigquery' });

    expect(out).toContain('alice@example.com');
    expect(out).not.toContain('alice:example');
  });

  it('preserves a $-key after a doubled-quote escape in the same string', async () => {
    // The `''` inside the literal must not be read as the closing quote, or the
    // parser would fall out of "string mode" early and mangle the later $-key.
    const sql =
      `SELECT JSON_VALUE(p, '$."it''s $weird"') AS x FROM t LIMIT 5`;

    const out = await enforceQueryLimit(sql, { dialect: 'bigquery' });

    expect(out).toContain('$weird');
    expect(out).not.toContain(':weird');
  });

  it('works for the duckdb dialect ($-key in JSON path survives)', async () => {
    const sql =
      `SELECT json_extract_string(props, '$."$current_url"') AS url ` +
      `FROM events WHERE ts > :since LIMIT 20`;

    const out = await enforceQueryLimit(sql, { dialect: 'duckdb' });

    expect(out).toContain('$current_url');
    expect(out).toContain(':since');
    expect(out).not.toContain(':current_url');
  });

  it('does not mangle a $-prefixed double-quoted identifier (postgres)', async () => {
    const sql = `SELECT "$amount" FROM t WHERE id > :min_id LIMIT 10`;

    const out = await enforceQueryLimit(sql, { dialect: 'postgres' });

    expect(out).toContain('"$amount"');
    expect(out).toContain(':min_id');
    expect(out).not.toContain('":amount"');
  });

  it('returns an in-bounds query BYTE-IDENTICAL — no parser round-trip on valid agent SQL', async () => {
    // The strongest guard: when a LIMIT is already present and within bounds, the query must come back
    // exactly as written (GA4 UNNEST + wildcard suffix + SAFE date parse), never re-generated — so no
    // regeneration bug can corrupt correct agent SQL.
    const sql =
      "SELECT event_name, COUNT(*) AS n\n" +
      "FROM `proj`.`ga4`.`events_*`\n" +
      "WHERE _TABLE_SUFFIX BETWEEN '20250401' AND '20250403'\n" +
      "  AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') LIKE '%/pricing%'\n" +
      "GROUP BY 1 ORDER BY n DESC LIMIT 100";
    const out = await enforceQueryLimit(sql, { maxLimit: 10000, dialect: 'bigquery' });
    expect(out).toBe(sql);
  });
});
