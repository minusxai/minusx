/**
 * Unit tests for filterSchemaByWhitelist — childPaths file vs folder scope semantics.
 *
 * Setup: context at /org/context (contextDir = /org)
 *   hosan_table   — childPaths: ['/org/hosan']
 *   starlife_table — childPaths: ['/org/starlife']
 *   common_table  — no childPaths (always visible)
 *
 * The 5 cases that must hold:
 *   1. /org (contextDir itself)        → all three tables
 *   2. /org/hosan  (folder scope)      → hosan_table + common_table only
 *   3. /org/starlife (folder scope)    → starlife_table + common_table only
 *   4. /org/starlife-dashboard (file)  → all three tables (files ignore childPaths)
 *   5. /org/some-folder (folder scope) → common_table only (not in any childPaths)
 */

import { filterSchemaByWhitelist } from '../schema-filter';
import type { DatabaseSchema, WhitelistItem } from '../../types';

const CONTEXT_DIR = '/org';

const fullSchema: DatabaseSchema = {
  updated_at: '2024-01-01',
  schemas: [{
    schema: 'public',
    tables: [
      { table: 'hosan_table', columns: [] },
      { table: 'starlife_table', columns: [] },
      { table: 'common_table', columns: [] },
    ],
  }],
};

const whitelist: WhitelistItem[] = [
  { name: 'hosan_table',   type: 'table', schema: 'public', childPaths: ['/org/hosan'] },
  { name: 'starlife_table', type: 'table', schema: 'public', childPaths: ['/org/starlife'] },
  { name: 'common_table',  type: 'table', schema: 'public' }, // no childPaths — always visible
];

function tables(result: DatabaseSchema): string[] {
  return result.schemas[0]?.tables.map(t => t.table) ?? [];
}

describe('filterSchemaByWhitelist — childPaths file vs folder scope', () => {
  // Case 1: the contextDir folder itself always sees everything
  it('case 1: /org (contextDir itself) sees all tables', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, CONTEXT_DIR, CONTEXT_DIR);
    expect(tables(result)).toEqual(expect.arrayContaining(['hosan_table', 'starlife_table', 'common_table']));
    expect(tables(result)).toHaveLength(3);
  });

  // Case 2: a named folder scope only sees what childPaths allows it
  it('case 2: /org/hosan folder scope sees hosan_table and common_table only', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/hosan', CONTEXT_DIR);
    expect(tables(result)).toContain('hosan_table');
    expect(tables(result)).toContain('common_table');
    expect(tables(result)).not.toContain('starlife_table');
  });

  // Case 3: symmetric — starlife folder sees only its own tables
  it('case 3: /org/starlife folder scope sees starlife_table and common_table only', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/starlife', CONTEXT_DIR);
    expect(tables(result)).toContain('starlife_table');
    expect(tables(result)).toContain('common_table');
    expect(tables(result)).not.toContain('hosan_table');
  });

  // Case 4: file queries don't pass currentPath — childPaths is never applied
  it('case 4: file query (no currentPath) sees all tables', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist);
    expect(tables(result)).toEqual(expect.arrayContaining(['hosan_table', 'starlife_table', 'common_table']));
    expect(tables(result)).toHaveLength(3);
  });

  // Case 5: a folder scope not in any childPaths sees only unrestricted tables
  it('case 5: /org/some-folder folder scope sees only common_table', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/some-folder', CONTEXT_DIR);
    expect(tables(result)).toContain('common_table');
    expect(tables(result)).not.toContain('hosan_table');
    expect(tables(result)).not.toContain('starlife_table');
  });

  // Bonus: nested path under /org/hosan also passes (startsWith)
  it('nested path /org/hosan/subfolder passes for hosan_table', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/hosan/subfolder', CONTEXT_DIR);
    expect(tables(result)).toContain('hosan_table');
    expect(tables(result)).not.toContain('starlife_table');
  });

  // Bonus: empty childPaths — table visible nowhere (current behaviour preserved)
  it('empty childPaths [] blocks table for all folder scopes', () => {
    const wl: WhitelistItem[] = [
      { name: 'restricted_table', type: 'table', schema: 'public', childPaths: [] },
    ];
    const schema: DatabaseSchema = { updated_at: '2024-01-01', schemas: [{ schema: 'public', tables: [{ table: 'restricted_table', columns: [] }] }] };
    const result = filterSchemaByWhitelist(schema, wl, '/org/hosan', CONTEXT_DIR);
    expect(tables(result)).not.toContain('restricted_table');
  });
});
