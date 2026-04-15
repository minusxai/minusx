/**
 * Unit tests for filterSchemaByWhitelist — childPaths file vs folder scope semantics.
 *
 * Setup: context at /org/context (contextDir = /org)
 *   team_a_table  — childPaths: ['/org/team_a']
 *   team_b_table  — childPaths: ['/org/team_b']
 *   shared_table  — no childPaths (always visible)
 *
 * The cases that must hold:
 *   1. /org (contextDir itself)                → all three tables
 *   2. /org/team_a  (folder scope)             → team_a_table + shared_table only
 *   3. /org/team_b (folder scope)              → team_b_table + shared_table only
 *   4. /org/some-question (file in contextDir) → all three tables (contextDir itself)
 *   5. /org/some-folder (folder scope)         → shared_table only (not in any childPaths)
 *   6. /org/team_a/my-question (file in team_a) → team_a_table + shared_table (inherits folder)
 *   7. /org/team_b/my-dash (file in team_b)    → team_b_table + shared_table (inherits folder)
 */

import { filterSchemaByWhitelist } from '../schema-filter';
import type { DatabaseSchema, WhitelistItem } from '../../types';

const CONTEXT_DIR = '/org';

const fullSchema: DatabaseSchema = {
  updated_at: '2024-01-01',
  schemas: [{
    schema: 'public',
    tables: [
      { table: 'team_a_table', columns: [] },
      { table: 'team_b_table', columns: [] },
      { table: 'shared_table', columns: [] },
    ],
  }],
};

const whitelist: WhitelistItem[] = [
  { name: 'team_a_table', type: 'table', schema: 'public', childPaths: ['/org/team_a'] },
  { name: 'team_b_table', type: 'table', schema: 'public', childPaths: ['/org/team_b'] },
  { name: 'shared_table', type: 'table', schema: 'public' }, // no childPaths — always visible
];

function tables(result: DatabaseSchema): string[] {
  return result.schemas[0]?.tables.map(t => t.table) ?? [];
}

describe('filterSchemaByWhitelist — childPaths file vs folder scope', () => {
  // Case 1: the contextDir folder itself always sees everything
  it('case 1: /org (contextDir itself) sees all tables', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, CONTEXT_DIR, CONTEXT_DIR);
    expect(tables(result)).toEqual(expect.arrayContaining(['team_a_table', 'team_b_table', 'shared_table']));
    expect(tables(result)).toHaveLength(3);
  });

  // Case 2: a named folder scope only sees what childPaths allows it
  it('case 2: /org/team_a folder scope sees team_a_table and shared_table only', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/team_a', CONTEXT_DIR);
    expect(tables(result)).toContain('team_a_table');
    expect(tables(result)).toContain('shared_table');
    expect(tables(result)).not.toContain('team_b_table');
  });

  // Case 3: symmetric — teamb folder sees only its own tables
  it('case 3: /org/team_b folder scope sees team_b_table and shared_table only', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/team_b', CONTEXT_DIR);
    expect(tables(result)).toContain('team_b_table');
    expect(tables(result)).toContain('shared_table');
    expect(tables(result)).not.toContain('team_a_table');
  });

  // Case 4: file IN contextDir itself (e.g. /org/some-question) sees all tables
  it('case 4: file in contextDir (/org/some-question) sees all tables', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, CONTEXT_DIR, CONTEXT_DIR);
    expect(tables(result)).toEqual(expect.arrayContaining(['team_a_table', 'team_b_table', 'shared_table']));
    expect(tables(result)).toHaveLength(3);
  });

  // Case 6: file inside /org/team_a should see only what /org/team_a folder sees
  // A file inherits its parent directory's context — it should NOT bypass childPaths
  it('case 6: file in /org/team_a (/org/team_a/my-question) sees team_a_table + shared_table only', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/team_a', CONTEXT_DIR);
    expect(tables(result)).toContain('team_a_table');
    expect(tables(result)).toContain('shared_table');
    expect(tables(result)).not.toContain('team_b_table');
  });

  // Case 7: file inside /org/team_b should see only what /org/team_b folder sees
  it('case 7: file in /org/team_b (/org/team_b/my-dashboard) sees team_b_table + shared_table only', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/team_b', CONTEXT_DIR);
    expect(tables(result)).toContain('team_b_table');
    expect(tables(result)).toContain('shared_table');
    expect(tables(result)).not.toContain('team_a_table');
  });

  // Case 5: a folder scope not in any childPaths sees only unrestricted tables
  it('case 5: /org/some-folder folder scope sees only shared_table', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/some-folder', CONTEXT_DIR);
    expect(tables(result)).toContain('shared_table');
    expect(tables(result)).not.toContain('team_a_table');
    expect(tables(result)).not.toContain('team_b_table');
  });

  // Bonus: nested path under /org/team_a also passes (startsWith)
  it('nested path /org/team_a/subfolder passes for team_a_table', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/team_a/subfolder', CONTEXT_DIR);
    expect(tables(result)).toContain('team_a_table');
    expect(tables(result)).not.toContain('team_b_table');
  });

  // Bonus: empty childPaths — table visible nowhere (current behaviour preserved)
  it('empty childPaths [] blocks table for all folder scopes', () => {
    const wl: WhitelistItem[] = [
      { name: 'restricted_table', type: 'table', schema: 'public', childPaths: [] },
    ];
    const schema: DatabaseSchema = { updated_at: '2024-01-01', schemas: [{ schema: 'public', tables: [{ table: 'restricted_table', columns: [] }] }] };
    const result = filterSchemaByWhitelist(schema, wl, '/org/team_a', CONTEXT_DIR);
    expect(tables(result)).not.toContain('restricted_table');
  });
});
