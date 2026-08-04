/**
 * InternalDbConnector must report real per-column types from the driver's field
 * metadata (PG type OIDs), not 'text' for every column. A COUNT(*) typed as
 * 'text' reaches the viz layer as a nominal field and renders a categorical
 * axis instead of a continuous one.
 */
import { describe, it, expect } from 'vitest';
import { InternalDbConnector } from '../internal-db-connector';

const connector = new InternalDbConnector('internals', {});

describe('InternalDbConnector column types', () => {
  it('reports driver types per column instead of text for everything', async () => {
    const result = await connector.query(
      "SELECT 'x'::text AS s, 1::int AS n, COUNT(*) AS c, now()::timestamp AS t " +
      'FROM (VALUES (1), (2)) v(a) GROUP BY s, n, t'
    );
    expect(result.columns).toEqual(['s', 'n', 'c', 't']);
    expect(result.types).toEqual(['text', 'integer', 'bigint', 'timestamp without time zone']);
  });

  it('reports column names and types even for an empty result', async () => {
    const result = await connector.query('SELECT 1::int AS n WHERE FALSE');
    expect(result.columns).toEqual(['n']);
    expect(result.types).toEqual(['integer']);
  });
});
