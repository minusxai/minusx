import { describe, it, expect } from 'vitest';
import type { AutoContextPayload } from '../payload-shape';
import { renderAutoContextPayload } from '../render';

const PAYLOAD: AutoContextPayload = {
  tables: [
    {
      connection: 'db',
      schema: 'public',
      table: 'users',
      tableNote: 'core user table',
      columns: [
        { name: 'id', note: 'primary key' },
        { name: 'email', note: '' }, // empty note: skipped
        { name: 'role', note: 'enum: admin/member/guest' },
      ],
      joins: [{
        fromColumn: 'id',
        toTable: 'orders',
        toColumn: 'user_id',
        evidence: 'COUNT(*) JOIN returned 42 rows',
      }],
    },
  ],
  examples: [{
    description: 'first order per user',
    connection: 'db',
    query: 'SELECT user_id, MIN(created_at) FROM orders GROUP BY user_id',
    rows: [{ user_id: 1, min: '2024-01-01' }],
  }],
};

describe('renderAutoContextPayload', () => {
  it('renders header, per-table block, joins, and examples', () => {
    const out = renderAutoContextPayload(PAYLOAD, 10_000);
    expect(out).toContain('# Auto-discovered schema context');
    expect(out).toContain('## db.public.users');
    expect(out).toContain('core user table');
    expect(out).toContain('| id | primary key |');
    expect(out).toContain('| role | enum: admin/member/guest |');
    // Empty notes are skipped.
    expect(out).not.toContain('| email |');
    expect(out).toContain('Joins:');
    expect(out).toContain('id → orders.user_id — COUNT(*) JOIN returned 42 rows');
    expect(out).toContain('# Example queries');
    expect(out).toContain('### Example 1: first order per user');
    expect(out).toContain('SELECT user_id, MIN(created_at) FROM orders GROUP BY user_id');
    expect(out).toContain('"user_id":1');
  });

  it('drops trailing content past the char budget', () => {
    // Tiny budget — only the header fits.
    const out = renderAutoContextPayload(PAYLOAD, 50);
    expect(out).toBe('# Auto-discovered schema context');
  });

  it('escapes pipe + newline characters inside notes (table-row safety)', () => {
    const payload: AutoContextPayload = {
      tables: [{
        connection: 'db',
        schema: 'public',
        table: 't',
        tableNote: '',
        columns: [{ name: 'c', note: 'has | pipe\nand newline' }],
        joins: [],
      }],
      examples: [],
    };
    const out = renderAutoContextPayload(payload, 10_000);
    // Pipe escaped, newline flattened to space.
    expect(out).toContain('has \\| pipe and newline');
  });
});
