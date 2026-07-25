/**
 * Dialect-aware table completion.
 *
 * BigQuery has no default dataset (bigquery-connector.ts never sets one), so a bare
 * `FROM app_events` is always rejected by the API:
 *   Table "app_events" must be qualified with a dataset (e.g. dataset.table).
 * Offering the bare name as a completion walks the user straight into that error, so
 * for such dialects only the `dataset.table` form may be suggested. Dialects with a
 * usable default schema (duckdb, postgres, ...) keep both forms.
 */
import { getCompletionsLocal } from '@/lib/sql/autocomplete';
import type { DatabaseWithSchema } from '@/lib/types';

const SCHEMA: DatabaseWithSchema[] = [{
  databaseName: 'mxbi',
  schemas: [{
    schema: 'V3minusx_prod',
    tables: [
      { table: 'app_events', columns: [{ name: 'id', type: 'INTEGER' }] },
      { table: 'companies', columns: [{ name: 'id', type: 'INTEGER' }] },
    ],
  }],
}] as unknown as DatabaseWithSchema[];

async function labelsFor(query: string, connectionType: string): Promise<string[]> {
  const suggestions = await getCompletionsLocal(query, query.length, SCHEMA, connectionType);
  return suggestions.map(s => s.label);
}

describe('table completion — dialects requiring dataset qualification', () => {
  test('BigQuery offers only the qualified table name in a FROM clause', async () => {
    const labels = await labelsFor('select * from ', 'bigquery');

    expect(labels).toContain('V3minusx_prod.app_events');
    expect(labels).toContain('V3minusx_prod.companies');
    expect(labels).not.toContain('app_events');
    expect(labels).not.toContain('companies');
  });

  test('BigQuery still offers the dataset itself, so `dataset.` dot-completion works', async () => {
    const labels = await labelsFor('select * from ', 'bigquery');
    expect(labels).toContain('V3minusx_prod');
  });

  test('BigQuery stays qualified-only on the unparseable fallback path', async () => {
    // No parseable AST — exercises getAllTablesUnfiltered rather than getTableCompletions.
    const labels = await labelsFor('from ', 'bigquery');

    expect(labels).toContain('V3minusx_prod.app_events');
    expect(labels).not.toContain('app_events');
  });

  test('BigQuery dot-completion after `dataset.` still inserts the bare table name', async () => {
    const suggestions = await getCompletionsLocal(
      'select * from V3minusx_prod.',
      'select * from V3minusx_prod.'.length,
      SCHEMA,
      'bigquery',
    );
    const appEvents = suggestions.find(s => s.label === 'app_events');
    expect(appEvents?.insert_text).toBe('app_events');
  });

  test('DuckDB keeps both the bare and the qualified form', async () => {
    const labels = await labelsFor('select * from ', 'duckdb');

    expect(labels).toContain('app_events');
    expect(labels).toContain('V3minusx_prod.app_events');
  });
});

/**
 * The connection type is not itself a parser dialect. `csv` and `google-sheets` are
 * DuckDB-backed; handing those strings to the parser yields no AST, silently dropping
 * every query onto the degraded unparseable-fallback path.
 */
describe('connection type → parser dialect', () => {
  test('CSV connections reach the parsed path, same as DuckDB', async () => {
    const csv = await labelsFor('select * from ', 'csv');
    const duckdb = await labelsFor('select * from ', 'duckdb');

    expect(csv).toEqual(duckdb);
    // The qualified form is only produced by the parsed path, never by the fallback.
    expect(csv).toContain('V3minusx_prod.app_events');
  });

  test('Google Sheets connections reach the parsed path, same as DuckDB', async () => {
    expect(await labelsFor('select * from ', 'google-sheets'))
      .toEqual(await labelsFor('select * from ', 'duckdb'));
  });

  test('dialects whose name differs from the connection type still parse', async () => {
    for (const type of ['postgresql', 'athena', 'sqlite', 'clickhouse', 'bigquery']) {
      expect(await labelsFor('select * from ', type)).toContain('V3minusx_prod.app_events');
    }
  });
});
