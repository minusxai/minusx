/**
 * BigQuery binds declared `date` params as DATE (not STRING), so `date_col >= @d`
 * compiles. Captures the job config handed to createQueryJob. BigQuery mocked.
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
  return { BigQuery: class { async createQueryJob(cfg: any) { captured.config = cfg; return [job]; } } };
});

import { describe, it, expect, beforeEach } from 'vitest';
import { BigQueryConnector } from '../bigquery-connector';

describe('BigQueryConnector — declared date params bind as DATE', () => {
  beforeEach(() => { captured.config = null; });

  it('types a declared `date` param as DATE in the job config', async () => {
    const conn = new BigQueryConnector('bq', { project_id: 'p', service_account_json: '{}' });
    await conn.queryStream(
      'SELECT * FROM t WHERE order_date >= :start',
      { start: '2024-01-01' },
      undefined,
      { start: 'date' },
    );
    expect(captured.config.query).toContain('@start');
    expect(captured.config.params).toEqual({ start: '2024-01-01' }); // still bound, not inlined
    expect(captured.config.types.start).toBe('DATE');
  });

  it('does NOT type text/number params (BigQuery infers those correctly)', async () => {
    const conn = new BigQueryConnector('bq', { project_id: 'p', service_account_json: '{}' });
    await conn.queryStream(
      'SELECT * FROM t WHERE name = :n AND amt > :a',
      { n: 'bob', a: 5 },
      undefined,
      { n: 'text', a: 'number' },
    );
    // No DATE types forced; n/a left to BigQuery inference (types may be absent).
    expect(captured.config.types?.n).toBeUndefined();
    expect(captured.config.types?.a).toBeUndefined();
  });

  it('falls back (no DATE type) for a malformed date value', async () => {
    const conn = new BigQueryConnector('bq', { project_id: 'p', service_account_json: '{}' });
    await conn.queryStream(
      'SELECT * FROM t WHERE d >= :d',
      { d: '2024-01-01T00:00:00Z' }, // has time → not a clean YYYY-MM-DD
      undefined,
      { d: 'date' },
    );
    expect(captured.config.types?.d).toBeUndefined();
  });
});
