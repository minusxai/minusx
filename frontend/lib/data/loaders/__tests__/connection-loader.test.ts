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
import * as pythonBackend from '@/lib/backend/python-backend.server';

// Force the Python path for all schema fetches — no Node.js connector
jest.mock('@/lib/connections', () => ({
  getNodeConnector: () => null,
}));

// Database-specific mock — must be at module top level (Jest hoisting)
jest.mock('@/lib/database/db-config', () => ({
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

const mockGetSchemaFromPython = jest.spyOn(pythonBackend, 'getSchemaFromPython');

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
  mockGetSchemaFromPython.mockReset();
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
// Cached (fresh) schema — no Python call
// ---------------------------------------------------------------------------

describe('connectionLoader — fresh schema cached', () => {
  it('returns cached schema without calling Python when schema is fresh', async () => {
    const freshSchema: DatabaseSchema = {
      schemas: [{ schema: 'public', tables: [] }],
      updated_at: freshTimestamp(),
    };
    const file = await createConnection('conn_fresh', '/org/database/conn_fresh', freshSchema);

    const result = await connectionLoader(file!, testUser);

    expect(mockGetSchemaFromPython).not.toHaveBeenCalled();
    const content = result.content as ConnectionContent;
    expect(content.schema?.schemas).toEqual(freshSchema.schemas);
  });
});

// ---------------------------------------------------------------------------
// Missing / stale schema — fetches Python and persists to DB
// ---------------------------------------------------------------------------

describe('connectionLoader — stale or missing schema', () => {
  it('fetches and persists schema when no schema exists', async () => {
    mockGetSchemaFromPython.mockResolvedValue(FRESH_SCHEMA);
    const file = await createConnection('conn_noschema', '/org/database/conn_noschema');

    const result = await connectionLoader(file!, testUser);

    expect(mockGetSchemaFromPython).toHaveBeenCalledTimes(1);
    const content = result.content as ConnectionContent;
    expect(content.schema?.schemas).toEqual(FRESH_SCHEMA.schemas);

    // Verify the schema was persisted back to DB
    const reloaded = await DocumentDB.getById(file!.id);
    const reloadedContent = reloaded?.content as ConnectionContent;
    expect(reloadedContent.schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
  });

  it('fetches and persists schema when schema is stale (> 24 hours old)', async () => {
    mockGetSchemaFromPython.mockResolvedValue(FRESH_SCHEMA);
    const staleSchema: DatabaseSchema = {
      schemas: [{ schema: 'old', tables: [] }],
      updated_at: staleTimestamp(),
    };
    const file = await createConnection('conn_stale', '/org/database/conn_stale', staleSchema);

    const result = await connectionLoader(file!, testUser);

    expect(mockGetSchemaFromPython).toHaveBeenCalledTimes(1);
    const content = result.content as ConnectionContent;
    expect(content.schema?.schemas).toEqual(FRESH_SCHEMA.schemas);

    // Verify the updated schema was persisted
    const reloaded = await DocumentDB.getById(file!.id);
    const reloadedContent = reloaded?.content as ConnectionContent;
    expect(reloadedContent.schema?.schemas).toEqual(FRESH_SCHEMA.schemas);
  });

  it('fetches schema when refresh=true even if schema is fresh', async () => {
    mockGetSchemaFromPython.mockResolvedValue(FRESH_SCHEMA);
    const alreadyFreshSchema: DatabaseSchema = {
      schemas: [{ schema: 'cached', tables: [] }],
      updated_at: freshTimestamp(),
    };
    const file = await createConnection('conn_forcerefresh', '/org/database/conn_forcerefresh', alreadyFreshSchema);

    await connectionLoader(file!, testUser, { refresh: true });

    expect(mockGetSchemaFromPython).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Error fallback behaviour
// ---------------------------------------------------------------------------

describe('connectionLoader — Python fetch failure', () => {
  it('returns cached schema when Python fetch fails and cache exists', async () => {
    mockGetSchemaFromPython.mockRejectedValue(new Error('backend unavailable'));
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

  it('returns empty schema when Python fetch fails and no cache exists', async () => {
    mockGetSchemaFromPython.mockRejectedValue(new Error('backend unavailable'));
    const file = await createConnection('conn_noschema_err', '/org/database/conn_noschema_err');

    const result = await connectionLoader(file!, testUser);

    const content = result.content as ConnectionContent;
    expect(content.schema?.schemas).toEqual([]);
    expect(content.schema?.updated_at).toBeDefined();
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
    expect(mockGetSchemaFromPython).not.toHaveBeenCalled();
  });
});
