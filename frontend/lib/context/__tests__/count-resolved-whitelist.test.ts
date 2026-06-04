/**
 * countResolvedWhitelist — counts whitelist items that still exist in the
 * loader-resolved `fullSchema`. Stale entries (deleted connection / schema /
 * table) must be excluded so the footer count matches what the agent sees.
 */

import { describe, it, expect } from 'vitest';
import { countResolvedWhitelist } from '../context-utils';
import type { DatabaseWithSchema, WhitelistItem } from '@/lib/types';

const fullSchema: DatabaseWithSchema[] = [
  {
    databaseName: 'static',
    schemas: [
      { schema: 'ships', tables: [{ table: 'arrivals', columns: [] }, { table: 'ports', columns: [] }] },
      { schema: 'sales', tables: [{ table: 'orders', columns: [] }] },
    ],
  },
];

function db(databaseName: string, whitelist: WhitelistItem[]) {
  return { databaseName, whitelist };
}

describe('countResolvedWhitelist', () => {
  it('counts only schema items that still exist', () => {
    const databases = [db('static', [
      { name: 'ships', type: 'schema' },
      { name: 'deleted_dataset', type: 'schema' }, // stale
    ])];
    expect(countResolvedWhitelist(databases, fullSchema)).toEqual({ databases: 1, items: 1 });
  });

  it('counts table items by schema + table name, dropping stale tables', () => {
    const databases = [db('static', [
      { name: 'arrivals', type: 'table', schema: 'ships' },
      { name: 'ghost', type: 'table', schema: 'ships' },     // stale table
      { name: 'orders', type: 'table', schema: 'gone' },     // stale schema
    ])];
    expect(countResolvedWhitelist(databases, fullSchema)).toEqual({ databases: 1, items: 1 });
  });

  it('excludes a database whose connection no longer exists', () => {
    const databases = [db('deleted_conn', [{ name: 'ships', type: 'schema' }])];
    expect(countResolvedWhitelist(databases, fullSchema)).toEqual({ databases: 0, items: 0 });
  });

  it('returns 0/0 when every whitelisted item is stale', () => {
    const databases = [db('static', [
      { name: 'gone1', type: 'schema' },
      { name: 'gone2', type: 'schema' },
    ])];
    expect(countResolvedWhitelist(databases, fullSchema)).toEqual({ databases: 0, items: 0 });
  });

  it('counts surviving items across multiple databases', () => {
    const multi: DatabaseWithSchema[] = [
      ...fullSchema,
      { databaseName: 'warehouse', schemas: [{ schema: 'fct', tables: [{ table: 'rev', columns: [] }] }] },
    ];
    const databases = [
      db('static', [{ name: 'ships', type: 'schema' }, { name: 'sales', type: 'schema' }]),
      db('warehouse', [{ name: 'rev', type: 'table', schema: 'fct' }]),
    ];
    expect(countResolvedWhitelist(databases, multi)).toEqual({ databases: 2, items: 3 });
  });
});
