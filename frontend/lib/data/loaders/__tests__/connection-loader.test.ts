/**
 * Connection Loader Tests
 *
 * Tests schema caching, refresh, and error-fallback behaviour for connectionLoader.
 * These tests cover the behaviour that must survive the refactor away from
 * direct DocumentDB.update usage in connection-loader.ts.
 *
 * Run: npm test -- connection-loader.test.ts
 */

import { DocumentDB } from '@/lib/database/documents-db';
import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import {
  initTestDatabase,
  cleanupTestDatabase,
  getTestDbPath,
} from '@/store/__tests__/test-utils';
import type { ConnectionContent, DatabaseSchema } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
// Inject schema via a fake Node.js connector (the loader fetches schema through
// `getNodeConnector(...).getSchema()`). `mockGetSchema` is the test seam.
const { mockGetSchema } = vi.hoisted(() => ({ mockGetSchema: vi.fn() }));

vi.mock('@/lib/connections', () => ({
  getNodeConnector: () => ({
    getSchema: mockGetSchema,
    query: vi.fn().mockResolvedValue({ columns: [], types: [], rows: [] }),
  }),
}));

// Pass-through profiling so schema enrichment doesn't run queries or mutate the
// fetched schema (keeps assertions about the raw schema valid).
vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_type: string, schemas: unknown) => ({ schema: schemas, queryCount: 0 })),
}));

// Database-specific mock — must be at module top level (Jest hoisting)
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const TEST_DB_PATH = getTestDbPath('connection_loader');

const testUser: EffectiveUser = {
  userId: 1,
  name: 'Test User',
  email: 'test@example.com',
  role: 'admin',
  mode: 'org',
  home_folder: '',
};

const FRESH_SCHEMA: DatabaseSchema = {
  schemas: [{ schema: 'public', tables: [{ table: 'users', columns: [{ name: 'id', type: 'INTEGER' }] }] }],
  updated_at: new Date().toISOString(),
};

beforeAll(async () => {
  await initTestDatabase(TEST_DB_PATH);
});

afterAll(async () => {
  await cleanupTestDatabase(TEST_DB_PATH);
});

beforeEach(() => {
  mockGetSchema.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createConnection(name: string, path: string, schema?: DatabaseSchema) {
  const content: ConnectionContent = {
    type: 'postgresql',
    config: { host: 'localhost' },
    ...(schema && { schema }),
  };
  const id = await DocumentDB.create(name, path, 'connection', content, []);
  return DocumentDB.getById(id);
}

function staleTimestamp() {
  return new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
}

function freshTimestamp() {
  return new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
}

// ---------------------------------------------------------------------------
// Cached (fresh) schema — no schema fetch
// ---------------------------------------------------------------------------

describe('connectionLoader — fresh schema cached', () => {
  it('returns cached schema without fetching when schema is fresh', async () => {
    const freshSchema: DatabaseSchema = {
      schemas: [{ schema: 'public', tables: [] }],
      updated_at: freshTimestamp(),
    };
    const file = await createConnection('conn_fresh', '/org/database/conn_fresh', freshSchema);

    const result = await connectionLoader(file!, testUser);

    expect(mockGetSchema).not.toHaveBeenCalled();
    const content = result.content as ConnectionContent;
    expect(content.schema?.schemas).toEqual(freshSchema.schemas);
  });
});

// ---------------------------------------------------------------------------
// Missing / stale schema — fetches via the connector and persists to DB
// ---------------------------------------------------------------------------

describe('connectionLoader — stale or missing schema', () => {
  it('fetches and persists schema when no schema exists', async () => {
    mockGetSchema.mockResolvedValue(FRESH_SCHEMA.schemas);
    const file = await createConnection('conn_noschema', '/org/database/conn_noschema');

    const result = await connectionLoader(file!, testUser);

    expect(mockGetSchema).toHaveBeenCalledTimes(1);
    const content = result.content as ConnectionContent;
    expect(content.schema?.schemas).toEqual(FRESH_SCHEMA.schemas);

    // Verify the schema was persisted back to DB
    const reloaded = await DocumentDB.getById(file!.id);
    const reloadedContent = reloaded?.content as ConnectionContent;
    expect(reloadedContent.schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
  });

  it('fetches and persists schema when schema is stale (> 24 hours old)', async () => {
    mockGetSchema.mockResolvedValue(FRESH_SCHEMA.schemas);
    const staleSchema: DatabaseSchema = {
      schemas: [{ schema: 'old', tables: [] }],
      updated_at: staleTimestamp(),
    };
    const file = await createConnection('conn_stale', '/org/database/conn_stale', staleSchema);

    const result = await connectionLoader(file!, testUser);

    expect(mockGetSchema).toHaveBeenCalledTimes(1);
    const content = result.content as ConnectionContent;
    expect(content.schema?.schemas).toEqual(FRESH_SCHEMA.schemas);

    // Verify the updated schema was persisted
    const reloaded = await DocumentDB.getById(file!.id);
    const reloadedContent = reloaded?.content as ConnectionContent;
    expect(reloadedContent.schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
  });

  it('fetches schema when refresh=true even if schema is fresh', async () => {
    mockGetSchema.mockResolvedValue(FRESH_SCHEMA.schemas);
    const alreadyFreshSchema: DatabaseSchema = {
      schemas: [{ schema: 'cached', tables: [] }],
      updated_at: freshTimestamp(),
    };
    const file = await createConnection('conn_forcerefresh', '/org/database/conn_forcerefresh', alreadyFreshSchema);

    await connectionLoader(file!, testUser, { refresh: true });

    expect(mockGetSchema).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Error fallback behaviour
// ---------------------------------------------------------------------------

describe('connectionLoader — schema fetch failure', () => {
  it('returns cached schema when the schema fetch fails and cache exists', async () => {
    mockGetSchema.mockRejectedValue(new Error('backend unavailable'));
    const staleSchema: DatabaseSchema = {
      schemas: [{ schema: 'fallback', tables: [] }],
      updated_at: staleTimestamp(),
    };
    const file = await createConnection('conn_fallback', '/org/database/conn_fallback', staleSchema);

    const result = await connectionLoader(file!, testUser);

    // Should not throw — falls back to cached
    const content = result.content as ConnectionContent;
    expect(content.schema?.schemas).toEqual(staleSchema.schemas);
  });

  it('returns empty schema when the schema fetch fails and no cache exists', async () => {
    mockGetSchema.mockRejectedValue(new Error('backend unavailable'));
    const file = await createConnection('conn_noschema_err', '/org/database/conn_noschema_err');

    const result = await connectionLoader(file!, testUser);

    const content = result.content as ConnectionContent;
    expect(content.schema?.schemas).toEqual([]);
    expect(content.schema?.updated_at).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Defense-in-depth: empty refresh result must not clobber non-empty cache
// ---------------------------------------------------------------------------

describe('connectionLoader — empty refresh result', () => {
  it('keeps non-empty cached schema when refresh returns []', async () => {
    // Reproduces the production failure mode: refresh would otherwise overwrite
    // a healthy cached schema with [] (e.g. when pg_stats enrichment silently
    // returns nothing). The loader should detect the empty result and bail.
    mockGetSchema.mockResolvedValue([]);

    const cachedSchema: DatabaseSchema = {
      schemas: [{ schema: 'public', tables: [{ table: 'orders', columns: [{ name: 'id', type: 'integer' }] }] }],
      updated_at: staleTimestamp(),
    };
    const file = await createConnection('conn_empty_refresh', '/org/database/conn_empty_refresh', cachedSchema);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await connectionLoader(file!, testUser, { refresh: true });

      const content = result.content as ConnectionContent;
      expect(content.schema?.schemas).toEqual(cachedSchema.schemas);
      expect(content.schema?.updated_at).toBe(cachedSchema.updated_at);
      expect(warnSpy).toHaveBeenCalled();

      // DB should still hold the original cached schema, not [].
      const reloaded = await DocumentDB.getById(file!.id);
      const reloadedContent = reloaded?.content as ConnectionContent;
      expect(reloadedContent.schema?.schemas).toEqual(cachedSchema.schemas);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('connectionLoader — credential redaction', () => {
  async function createConnectionWithConfig(
    name: string,
    path: string,
    type: ConnectionContent['type'],
    config: Record<string, unknown>,
    schema?: DatabaseSchema,
  ) {
    const content: ConnectionContent = { type, config, ...(schema && { schema }) };
    const id = await DocumentDB.create(name, path, 'connection', content, []);
    return DocumentDB.getById(id);
  }

  it('strips postgres username/password from the returned config (fresh-schema path)', async () => {
    const freshSchema: DatabaseSchema = { schemas: [{ schema: 'public', tables: [] }], updated_at: freshTimestamp() };
    const file = await createConnectionWithConfig(
      'conn_pg_secret',
      '/org/database/conn_pg_secret',
      'postgresql',
      { host: 'db.internal', port: 5432, database: 'analytics', user: 'admin', password: 'hunter2' },
      freshSchema,
    );

    const result = await connectionLoader(file!, testUser);

    const config = (result.content as ConnectionContent).config;
    expect(config).toEqual({ host: 'db.internal', port: 5432, database: 'analytics' });
    expect(config.password).toBeUndefined();
    expect(config.user).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('strips bigquery service_account_json from the returned config (fetched-schema path)', async () => {
    mockGetSchema.mockResolvedValue(FRESH_SCHEMA.schemas);
    const file = await createConnectionWithConfig(
      'conn_bq_secret',
      '/org/database/conn_bq_secret',
      'bigquery',
      { project_id: 'my-proj', service_account_json: '{"private_key":"SUPER_SECRET"}' },
    );

    const result = await connectionLoader(file!, testUser);

    const config = (result.content as ConnectionContent).config;
    expect(config).toEqual({ project_id: 'my-proj' });
    expect(config.service_account_json).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('SUPER_SECRET');
  });

  it('leaves the raw credentials intact in the DB (redaction is presentation-only)', async () => {
    const freshSchema: DatabaseSchema = { schemas: [{ schema: 'public', tables: [] }], updated_at: freshTimestamp() };
    const file = await createConnectionWithConfig(
      'conn_pg_dbintact',
      '/org/database/conn_pg_dbintact',
      'postgresql',
      { host: 'db.internal', port: 5432, database: 'analytics', user: 'admin', password: 'hunter2' },
      freshSchema,
    );

    await connectionLoader(file!, testUser);

    const reloaded = await DocumentDB.getById(file!.id);
    const rawConfig = (reloaded?.content as ConnectionContent).config;
    expect(rawConfig.password).toBe('hunter2');
    expect(rawConfig.user).toBe('admin');
  });
});

// ---------------------------------------------------------------------------
// Metadata-only load (content === null)
// ---------------------------------------------------------------------------

describe('connectionLoader — metadata-only file', () => {
  it('returns file unchanged when content is null', async () => {
    const id = await DocumentDB.create('conn_meta', '/org/database/conn_meta', 'connection', { type: 'postgresql', config: {} }, []);
    const metaFile = { ...(await DocumentDB.getById(id))!, content: null };

    const result = await connectionLoader(metaFile, testUser);

    expect(result.content).toBeNull();
    expect(mockGetSchema).not.toHaveBeenCalled();
  });
});
