import { fuzzyMatch } from '../fuzzy-search';
import { profileDatabase } from '../statistics-engine';
import { buildSampleSql } from '@/agents/benchmark-analyst/v2/sample-sql';
import { renderDialectHints } from '@/agents/benchmark-analyst/v2/dialect-hints';

it('uses MySQL quoting and RAND for catalog samples', () => {
  expect(buildSampleSql('mysql', 'main', 'odd`table', 5)).toBe('SELECT * FROM `main`.`odd``table` ORDER BY RAND() LIMIT 5');
});

it('uses MySQL identifier quoting for fuzzy search, including embedded backticks', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [], columns: [], types: [], finalQuery: '' });
  await fuzzyMatch('mysql', query, { schema: 'analytics', table: 'order', columns: ['a`b'], searchTerm: "O'Brien" });
  expect(query.mock.calls[0][0]).toContain('`analytics`.`order`');
  expect(query.mock.calls[0][0]).toContain('`a``b`');
});

it('classifies MySQL/Doris columns without scanning warehouse tables during schema refresh', async () => {
  const query = vi.fn();
  const result = await profileDatabase('mysql', [{ schema: 'analytics', tables: [{ table: 'events', columns: [
    { name: 'id', type: 'bigint' }, { name: 'name', type: 'varchar' }, { name: 'ts', type: 'datetime' },
  ] }] }], query);
  expect(query).not.toHaveBeenCalled();
  expect(result.schema[0].tables[0].columns.map(c => c.meta?.category)).toEqual(['numeric', 'text', 'temporal']);
});

it('tells the agent about MySQL quoting and Doris compatibility', () => {
  expect(renderDialectHints(new Set(['mysql']))).toContain('Doris');
});
