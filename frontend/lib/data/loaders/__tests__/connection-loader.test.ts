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
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
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

  it('serves a stale schema immediately and refreshes it in the background', async () => {
    // Stale-while-revalidate: a slow introspection must NOT block the response.
    let resolveSchema!: (s: DatabaseSchema['schemas']) => void;
    mockGetSchema.mockReturnValue(new Promise((r) => { resolveSchema = r; }));
    const staleSchema: DatabaseSchema = {
      schemas: [{ schema: 'old', tables: [] }],
      updated_at: staleTimestamp(),
    };
    const file = await createConnection('conn_stale', '/org/database/conn_stale', staleSchema);

    // Returns the STALE schema right away, while getSchema is still pending
    const result = await connectionLoader(file!, testUser);
    const content = result.content as ConnectionContent;
    expect(content.schema?.schemas).toEqual(staleSchema.schemas);
    expect(mockGetSchema).toHaveBeenCalledTimes(1); // background refresh kicked off

    // Once introspection completes, the fresh schema is persisted
    resolveSchema(FRESH_SCHEMA.schemas);
    await vi.waitFor(async () => {
      const reloaded = await DocumentDB.getById(file!.id);
      const reloadedContent = reloaded?.content as ConnectionContent;
      expect(reloadedContent.schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
    });
  });

  it('fetches schema when refresh=true even if schema is fresh', async () => {
    mockGetSchema.mockResolvedValue(FRESH_SCHEMA.schemas);
    const alreadyFreshSchema: DatabaseSchema = {
      schemas: [{ schema: 'cached', tables: [] }],
      updated_at: freshTimestamp(),
    };
    const file = await createConnection('conn_forcerefresh', '/org/database/conn_forcerefresh', alreadyFreshSchema);

    // Explicit refresh is user-initiated → blocks and returns the FRESH schema
    const result = await connectionLoader(file!, testUser, { refresh: true });

    expect(mockGetSchema).toHaveBeenCalledTimes(1);
    expect((result.content as ConnectionContent).schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
  });

  it('deduplicates concurrent loads: one introspection serves all callers', async () => {
    let resolveSchema!: (s: DatabaseSchema['schemas']) => void;
    mockGetSchema.mockReturnValue(new Promise((r) => { resolveSchema = r; }));
    const file = await createConnection('conn_dedup', '/org/database/conn_dedup');

    // Three concurrent loads of a schema-less connection (each must block on
    // the fetch) — but only ONE introspection runs
    const loads = Promise.all([
      connectionLoader(file!, testUser),
      connectionLoader(file!, testUser),
      connectionLoader(file!, testUser),
    ]);
    await vi.waitFor(() => expect(mockGetSchema).toHaveBeenCalled());
    resolveSchema(FRESH_SCHEMA.schemas);
    const results = await loads;

    expect(mockGetSchema).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect((r.content as ConnectionContent).schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
    }
  });

  it('backgroundRefresh: serves the current schema now and re-profiles behind the scenes', async () => {
    // Post-save path: schema may be FRESH by timestamp but stale in fact
    // (tables just changed) — backgroundRefresh forces a refresh without blocking.
    let resolveSchema!: (s: DatabaseSchema['schemas']) => void;
    mockGetSchema.mockReturnValue(new Promise((r) => { resolveSchema = r; }));
    const cached: DatabaseSchema = {
      schemas: [{ schema: 'pre_save', tables: [] }],
      updated_at: freshTimestamp(),
    };
    const file = await createConnection('conn_bgrefresh', '/org/database/conn_bgrefresh', cached);

    const result = await connectionLoader(file!, testUser, { backgroundRefresh: true });

    // Served immediately with the cached schema; refresh started
    expect((result.content as ConnectionContent).schema?.schemas).toEqual(cached.schemas);
    expect(mockGetSchema).toHaveBeenCalledTimes(1);

    resolveSchema(FRESH_SCHEMA.schemas);
    await vi.waitFor(async () => {
      const reloaded = await DocumentDB.getById(file!.id);
      expect((reloaded?.content as ConnectionContent).schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
    });
  });
});

// ---------------------------------------------------------------------------
// Empty cached schemas — an empty array is NOT a usable schema (first upload)
// ---------------------------------------------------------------------------

describe('connectionLoader — empty cached schemas', () => {
  it('blocks and fetches on backgroundRefresh when cached schemas array is empty', async () => {
    // Repro of the onboarding bug (#460 regression): the static CSV connection
    // pre-exists with `schema.schemas = []`. A post-save backgroundRefresh must
    // NOT serve [] and refresh later (the client caches that for hours and shows
    // "No tables found") — with nothing useful to serve, it must block and
    // return the freshly-introspected tables.
    mockGetSchema.mockResolvedValue(FRESH_SCHEMA.schemas);
    const emptySchema: DatabaseSchema = { schemas: [], updated_at: freshTimestamp() };
    const file = await createConnection('conn_empty_bg', '/org/database/conn_empty_bg', emptySchema);

    const result = await connectionLoader(file!, testUser, { backgroundRefresh: true });

    expect(mockGetSchema).toHaveBeenCalledTimes(1);
    expect((result.content as ConnectionContent).schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
  });

  it('blocks and fetches on a normal load when cached schemas array is empty', async () => {
    mockGetSchema.mockResolvedValue(FRESH_SCHEMA.schemas);
    const emptySchema: DatabaseSchema = { schemas: [], updated_at: freshTimestamp() };
    const file = await createConnection('conn_empty_normal', '/org/database/conn_empty_normal', emptySchema);

    const result = await connectionLoader(file!, testUser);

    expect(mockGetSchema).toHaveBeenCalledTimes(1);
    expect((result.content as ConnectionContent).schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
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
// Saving a connection must not block on re-introspection
// ---------------------------------------------------------------------------

describe('FilesAPI.saveFile — connection save is non-blocking', () => {
  it('returns before introspection completes, preserves the previous schema, refreshes in background', async () => {
    const { FilesAPI } = await import('@/lib/data/files.server');

    const previousSchema: DatabaseSchema = {
      schemas: [{ schema: 'before_save', tables: [] }],
      updated_at: freshTimestamp(),
    };
    const file = await createConnection('conn_save', '/org/database/conn_save', previousSchema);

    // Introspection hangs until we release it — the save must return anyway
    let resolveSchema!: (s: DatabaseSchema['schemas']) => void;
    mockGetSchema.mockReturnValue(new Promise((r) => { resolveSchema = r; }));

    const newContent: ConnectionContent = {
      type: 'postgresql',
      config: { host: 'localhost', port: 5433 },
      // Client-sent schema must be ignored (server-managed field)
      schema: { schemas: [{ schema: 'client_junk', tables: [] }], updated_at: freshTimestamp() },
    };
    const saved = await FilesAPI.saveFile(
      file!.id, 'conn_save', '/org/database/conn_save', newContent, [], testUser,
    );

    // Save returned while getSchema is still pending — and serves the PREVIOUS schema
    const savedContent = saved.data.content as ConnectionContent;
    expect(savedContent.schema?.schemas).toEqual(previousSchema.schemas);
    expect(savedContent.config.port).toBe(5433);
    // Background refresh was kicked off
    expect(mockGetSchema).toHaveBeenCalled();

    // Once introspection completes, the fresh schema lands in the DB
    resolveSchema(FRESH_SCHEMA.schemas);
    await vi.waitFor(async () => {
      const reloaded = await DocumentDB.getById(file!.id);
      expect((reloaded?.content as ConnectionContent).schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
    });
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
