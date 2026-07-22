/**
 * getMentions whitelist invariant — the @ mention typeahead must offer ONLY
 * tables from the whitelistedSchemas the caller provides (resolved from the
 * context's whitelist). It must never widen to the connection's full schema
 * when a whitelist is present — even an EMPTY one (a context that exposes
 * nothing yields zero table mentions, not everything).
 */

import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { CompletionsAPI } from '../completions.server';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { DatabaseWithSchema } from '@/lib/types';

// The connection's FULL schema: users + orders + a secret table.
const FULL_SCHEMA = {
  schemas: [
    {
      schema: 'main',
      tables: [
        { table: 'users', columns: [{ name: 'id', type: 'INTEGER' }] },
        { table: 'orders', columns: [{ name: 'id', type: 'INTEGER' }] },
        { table: 'secret_finance', columns: [{ name: 'amount', type: 'DECIMAL' }] },
      ],
    },
  ],
};

// The context's whitelist exposes ONLY `users`.
const WHITELISTED: DatabaseWithSchema[] = [
  {
    databaseName: 'default_db',
    schemas: [
      { schema: 'main', tables: [{ table: 'users', columns: [{ name: 'id', type: 'INTEGER' }] }] },
    ],
  } as unknown as DatabaseWithSchema,
];

const mockUser: EffectiveUser = {
  userId: 1,
  name: 'Test User',
  email: 'test@example.com',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

const tableNames = (result: { suggestions: Array<{ type: string; name: string }> }) =>
  result.suggestions.filter((s) => s.type === 'table').map((s) => s.name);

describe('getMentions — whitelist is the ceiling', () => {
  setupTestDb(getTestDbPath('completions_mentions_whitelist'), {
    withTestConnection: true,
    customInit: async () => {
      const { getModules } = await import('@/lib/modules/registry');
      await getModules().db.exec(
        `UPDATE files SET content = $1 WHERE path = $2`,
        [
          JSON.stringify({
            id: 'test_connection',
            name: 'default_db',
            type: 'duckdb',
            config: { file_path: 'test.duckdb' },
            schema: FULL_SCHEMA,
          }),
          '/org/connections/test_connection',
        ],
      );
    },
  });

  it('offers only whitelisted tables, never the rest of the connection schema', async () => {
    const result = await CompletionsAPI.getMentions(
      { prefix: '', mentionType: 'all', databaseName: 'default_db', whitelistedSchemas: WHITELISTED },
      mockUser,
    );

    const tables = tableNames(result);
    expect(tables).toContain('users');
    expect(tables).not.toContain('orders');
    expect(tables).not.toContain('secret_finance');
  });

  it('an empty whitelist yields ZERO table mentions — no fallback to the full schema', async () => {
    const result = await CompletionsAPI.getMentions(
      { prefix: '', mentionType: 'all', databaseName: 'default_db', whitelistedSchemas: [] },
      mockUser,
    );

    expect(tableNames(result)).toEqual([]);
  });

  it('prefix search cannot reach outside the whitelist', async () => {
    const result = await CompletionsAPI.getMentions(
      { prefix: 'secret', mentionType: 'all', databaseName: 'default_db', whitelistedSchemas: WHITELISTED },
      mockUser,
    );

    expect(tableNames(result)).toEqual([]);
  });
});
