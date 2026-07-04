/**
 * getWhitelistForPath — a chain of '*' whitelists means UNRESTRICTED (null),
 * not "enumerate through the cached connection schema". Enumerating '*' blocks
 * tables created after the last schema refresh (e.g. a Google Sheet imported
 * seconds ago) even though the context exposes everything by design.
 */

const { mockGetSchema } = vi.hoisted(() => ({ mockGetSchema: vi.fn() }));

vi.mock('@/lib/connections', () => ({
  getNodeConnector: () => ({
    getSchema: mockGetSchema,
    query: vi.fn().mockResolvedValue({ columns: [], types: [], rows: [] }),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  }),
}));

vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, schemas: unknown) => ({ schema: schemas, queryCount: 0 })),
}));

import { DocumentDB } from '@/lib/database/documents-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getWhitelistForPath } from '@/lib/sql/whitelist-resolver.server';
import { makeDefaultContextContent } from '@/lib/context/context-utils';
import type { ConnectionContent, ContextContent, DatabaseSchema } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('whitelist_resolver');

const admin: EffectiveUser = {
  userId: 1, name: 'Admin', email: 'admin@test.com',
  role: 'admin', mode: 'org', home_folder: '',
};

// The cached schema deliberately KNOWS NOTHING about freshly created tables —
// '*' contexts must not be limited by it.
const CACHED_SCHEMA: DatabaseSchema = {
  schemas: [{ schema: 'public', tables: [{ table: 'old_table', columns: [{ name: 'id', type: 'INTEGER' }] }] }],
  updated_at: new Date().toISOString(),
};

describe('getWhitelistForPath — wildcard semantics', () => {
  setupTestDb(TEST_DB_PATH, {
    customInit: async () => {
      const conn: ConnectionContent = { type: 'postgresql', config: { host: 'localhost' }, schema: CACHED_SCHEMA };
      await DocumentDB.create('wh', '/org/database/wh', 'connection', conn, [], undefined, false);

      // Explicit whitelist context under /org/teamx — restricts to public schema of wh
      const explicit: ContextContent = {
        versions: [{
          version: 1,
          whitelist: [{ name: 'wh', type: 'connection', children: [{ name: 'public', type: 'schema' }] }] as any,
          docs: [],
          createdAt: new Date().toISOString(),
          createdBy: 1,
        }],
        published: { all: 1 },
      };
      await DocumentDB.create('context', '/org/teamx/context', 'context', explicit, [], undefined, false);

      // '*' context under /org/teamy — wildcard all the way up (root /org/context is '*' in the seed)
      await DocumentDB.create('context', '/org/teamy/context', 'context', makeDefaultContextContent(1), [], undefined, false);
    },
  });

  beforeEach(() => {
    mockGetSchema.mockReset();
    mockGetSchema.mockResolvedValue(CACHED_SCHEMA.schemas);
  });

  it("returns null (unrestricted) when every context in the chain is '*'", async () => {
    // Nearest match for /org/questions/q1 is the seeded root /org/context ('*')
    const result = await getWhitelistForPath('/org/questions/q1', 'wh', admin);
    expect(result).toBeNull();
  });

  it("returns null for a nested '*' context under a '*' root", async () => {
    const result = await getWhitelistForPath('/org/teamy/q1', 'wh', admin);
    expect(result).toBeNull();
  });

  it('still enumerates when the nearest context has an explicit whitelist', async () => {
    const result = await getWhitelistForPath('/org/teamx/q1', 'wh', admin);
    expect(result).not.toBeNull();
    expect(result!.map((s) => s.schema)).toContain('public');
  });
});
