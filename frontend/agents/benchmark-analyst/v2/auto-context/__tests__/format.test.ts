/**
 * Tests for format.ts — markdown rendering of the AutoContext block with
 * a hard char budget. When the budget is exceeded, the renderer drops
 * trailing (lowest-priority) tables until the result fits.
 */

import { describe, it, expect } from 'vitest';
import { renderAutoContext, type AnnotatedTable } from '../format';
import type { Example } from '../examples';

const aTable = (name: string, overrides: Partial<AnnotatedTable> = {}): AnnotatedTable => ({
  connection: 'db',
  schema: 'public',
  table: name,
  rowCount: 100,
  tableNote: `Holds ${name}.`,
  columns: [
    { name: 'id', type: 'INTEGER', note: 'identifier' },
    { name: 'name', type: 'VARCHAR', note: 'display name' },
  ],
  joins: [],
  samples: [{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }],
  ...overrides,
});

describe('renderAutoContext', () => {
  it('renders all tables when within budget', () => {
    const md = renderAutoContext({
      tables: [aTable('users'), aTable('orders')],
      examples: [],
    }, 50_000);

    expect(md).toContain('db.public.users');
    expect(md).toContain('db.public.orders');
    expect(md).toContain('Holds users.');
    expect(md).toContain('Holds orders.');
  });

  it('drops trailing tables when over budget', () => {
    // Sample rows scrubbed so the only place the table-name string can appear
    // is in the rendered table block itself.
    const t = (n: string) => aTable(n, { samples: [{ id: 1 }], tableNote: '' });

    // Hugely-undersized budget so only the first table fits.
    const md = renderAutoContext({
      tables: [t('first_unique_table'), t('second_unique_table'), t('third_unique_table')],
      examples: [],
    }, 300);

    expect(md).toContain('first_unique_table');
    expect(md).not.toContain('second_unique_table');
    expect(md).not.toContain('third_unique_table');
    expect(md.length).toBeLessThanOrEqual(300 + 50); // small overhead for header allowed
  });

  it('respects insertion order as priority order', () => {
    // Insertion order = priority. First in = highest priority.
    const md = renderAutoContext({
      tables: [aTable('high_priority'), aTable('low_priority')],
      examples: [],
    }, 600);
    const posHigh = md.indexOf('high_priority');
    const posLow = md.indexOf('low_priority');
    if (posHigh !== -1 && posLow !== -1) {
      expect(posHigh).toBeLessThan(posLow);
    } else {
      expect(posHigh).not.toBe(-1);
    }
  });

  it('includes an Example queries section when examples are provided', () => {
    const examples: Example[] = [{
      description: 'Joining users to orders',
      connection: 'db',
      query: 'SELECT u.id, o.amount FROM users u JOIN orders o ON u.id = o.user_id LIMIT 5',
      rows: [{ id: 1, amount: 50 }, { id: 2, amount: 120 }],
    }];
    const md = renderAutoContext({ tables: [aTable('users')], examples }, 50_000);
    expect(md).toContain('Example queries');
    expect(md).toContain('Joining users to orders');
    expect(md).toContain('SELECT u.id, o.amount');
  });

  it('renders joins involving each table', () => {
    const md = renderAutoContext({
      tables: [
        aTable('users', {
          joins: [
            { fromColumn: 'id', toTable: 'orders', toColumn: 'user_id', kind: 'direct', overlap: 0.97 },
          ],
        }),
      ],
      examples: [],
    }, 50_000);
    expect(md).toContain('id → orders.user_id');
    expect(md).toContain('direct');
  });

  it('renders sample rows compactly under each table', () => {
    const md = renderAutoContext({
      tables: [aTable('users', { samples: [{ id: 7 }] })],
      examples: [],
    }, 50_000);
    expect(md).toContain('Sample rows');
    expect(md).toContain('"id":7');
  });

  it('produces a non-empty result even when tables and examples are empty', () => {
    const md = renderAutoContext({ tables: [], examples: [] }, 50_000);
    expect(md.length).toBeGreaterThan(0);
  });

  it('always under maxChars (including overhead from examples section)', () => {
    const examples: Example[] = Array.from({ length: 5 }, (_, i) => ({
      description: `desc ${i}`.repeat(20),
      connection: 'db',
      query: 'SELECT * FROM very_long_query_text_here'.repeat(10),
      rows: Array.from({ length: 10 }, (_, j) => ({ x: 'y'.repeat(50), j })),
    }));
    const md = renderAutoContext({
      tables: Array.from({ length: 10 }, (_, i) => aTable(`t${i}`)),
      examples,
    }, 1000);
    expect(md.length).toBeLessThanOrEqual(1000);
  });
});
