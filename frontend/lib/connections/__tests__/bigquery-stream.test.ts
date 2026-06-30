/**
 * BigQueryConnector.queryStream: pages through job.getQueryResults (autoPaginate
 * off), schema from the first response. @google-cloud/bigquery mocked.
 */
vi.mock('@google-cloud/bigquery', () => {
  const job = {
    async getMetadata() { return [{ status: { state: 'DONE' } }]; },
    async getQueryResults(opts: any) {
      if (opts && opts.autoPaginate === false) {
        // First page + schema + next-page query.
        return [
          [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
          { pageToken: 'p2' },
          { schema: { fields: [{ name: 'id', type: 'INTEGER' }, { name: 'name', type: 'STRING' }] } },
        ];
      }
      // Subsequent page (called with the next-page query) → no further pages.
      return [[{ id: 3, name: 'c' }], null];
    },
  };
  return { BigQuery: class { async createQueryJob() { return [job]; } } };
});

import { describe, it, expect } from 'vitest';
import { BigQueryConnector } from '../bigquery-connector';
import { drainQueryStream } from '../base';

describe('BigQueryConnector.queryStream', () => {
  it('streams paged rows with schema from the first response', async () => {
    const conn = new BigQueryConnector('bq', { project_id: 'p', service_account_json: '{}' });
    const stream = await conn.queryStream('SELECT id, name FROM t');
    expect(stream.columns).toEqual(['id', 'name']);
    expect(stream.types).toEqual(['INTEGER', 'STRING']);
    const result = await drainQueryStream(stream);
    expect(result.rows).toEqual([
      { id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' },
    ]);
  });
});
