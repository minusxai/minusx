/**
 * BigQuery binds a declared `date` param as a REAL DATE value (BigQuery.date(),
 * a BigQueryDate) — NOT a string with `type:'DATE'`, which nulls the value in
 * the @google-cloud/bigquery client (verified against a live connection). Captures
 * the job config handed to createQueryJob. BigQuery mocked.
 */
const { captured } = vi.hoisted(() => {
  const captured: { config: any } = { config: null };
  return { captured };
});

vi.mock('@google-cloud/bigquery', () => {
  const job = {
    async getMetadata() { return [{ status: { state: 'DONE' } }]; },
    async getQueryResults(opts: any) {
      if (opts && opts.autoPaginate === false) return [[], null, { schema: { fields: [] } }];
      return [[], null];
    },
  };
  // Mirror the real static BigQuery.date() → a tagged BigQueryDate-like value.
  class BigQuery {
    static date(value: string) { return { value, _kind: 'BigQueryDate' }; }
    async createQueryJob(cfg: any) { captured.config = cfg; return [job]; }
  }
  return { BigQuery };
});

import { describe, it, expect, beforeEach } from 'vitest';
import { BigQueryConnector } from '../bigquery-connector';

describe('BigQueryConnector — declared date params bind as a real DATE value', () => {
  beforeEach(() => { captured.config = null; });

  it('binds a declared `date` param as a BigQueryDate value (not a string, no DATE type)', async () => {
    const conn = new BigQueryConnector('bq', { project_id: 'p', service_account_json: '{}' });
    await conn.queryStream(
      'SELECT * FROM t WHERE order_date >= :start',
      { start: '2024-01-01' },
      undefined,
      { start: 'date' },
    );
    expect(captured.config.query).toContain('@start');
    // Bound as a BigQueryDate VALUE — the client infers DATE from it.
    expect(captured.config.params.start).toEqual({ value: '2024-01-01', _kind: 'BigQueryDate' });
    // No explicit `types` entry for it (and definitely not the value-nulling 'DATE').
    expect(captured.config.types?.start).toBeUndefined();
  });

  it('leaves text/number params as plain values (BigQuery infers those correctly)', async () => {
    const conn = new BigQueryConnector('bq', { project_id: 'p', service_account_json: '{}' });
    await conn.queryStream(
      'SELECT * FROM t WHERE name = :n AND amt > :a',
      { n: 'bob', a: 5 },
      undefined,
      { n: 'text', a: 'number' },
    );
    expect(captured.config.params).toEqual({ n: 'bob', a: 5 });
    expect(captured.config.types?.n).toBeUndefined();
    expect(captured.config.types?.a).toBeUndefined();
  });

  it('falls back to a plain string for a malformed (non-YYYY-MM-DD) date value', async () => {
    const conn = new BigQueryConnector('bq', { project_id: 'p', service_account_json: '{}' });
    await conn.queryStream(
      'SELECT * FROM t WHERE d >= :d',
      { d: '2024-01-01T00:00:00Z' }, // has time → not a clean YYYY-MM-DD
      undefined,
      { d: 'date' },
    );
    expect(captured.config.params.d).toBe('2024-01-01T00:00:00Z'); // unchanged string
    expect(captured.config.types?.d).toBeUndefined();
  });

  it('still types a null param as STRING (BigQuery requires an explicit type for null)', async () => {
    const conn = new BigQueryConnector('bq', { project_id: 'p', service_account_json: '{}' });
    await conn.queryStream(
      'SELECT * FROM t WHERE x = :x',
      {}, // :x has no value → null
      undefined,
      {},
    );
    expect(captured.config.params.x).toBeNull();
    expect(captured.config.types.x).toBe('STRING');
  });
});
