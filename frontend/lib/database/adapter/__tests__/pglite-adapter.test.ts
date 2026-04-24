/**
 * Phase 2 spike validation — PGLite adapter via module registry
 *
 * Goal: prove PGLite can replace SQLite with zero query changes.
 * Tests every DocumentDB operation end-to-end against an in-memory PGLite instance.
 * No SQLite files, no mocked db-config — PGLite is the only DB used here.
 *
 * Pattern: registerModules({ db: new DBModule() }) in beforeEach.
 * Re-calling registerModules() overrides the default test module from jest.setup.ts.
 */

// Workspace mock is already in jest.setup.ts (getWorkspaceId → 1, runWithWorkspace → no-op)

jest.mock('@/lib/database/db-config', () => ({
  getDbType: jest.fn().mockReturnValue('pglite'),
  DB_PATH: undefined,
  DB_DIR: undefined,
}));

import { DocumentDB } from '@/lib/database/documents-db';
import { registerModules, getModules } from '@/lib/modules/registry';
import { DBModule } from '@/lib/modules/db';

function makeMockModules(db: DBModule) {
  return {
    auth: {
      handleRequest: async () => { throw new Error('not in tests'); },
      getRequestContext: async () => ({
        userId: 1, email: 'test@example.com', name: 'Test User',
        role: 'admin' as const, home_folder: '/org', mode: 'org' as const,
      }),
      addHeaders: async () => true,
      register: async () => { throw new Error('not in tests'); },
    },
    db,
    store: {
      resolvePath: () => '',
      getUploadUrl: async () => { throw new Error('not in tests'); },
      getDownloadUrl: async () => { throw new Error('not in tests'); },
      generateKey: () => { throw new Error('not in tests'); },
    },
    cache: {
      get: async () => null,
      set: async () => {},
      invalidate: async () => {},
      invalidatePrefix: async () => {},
    },
  };
}

describe('PGLite adapter — Phase 2 spike', () => {
  beforeAll(async () => {
    // Single PGlite instance for the whole suite — PGlite WASM cannot be restarted
    // after close() within the same process, so we init once and truncate between tests.
    registerModules(makeMockModules(new DBModule()));
    await getModules().db.init();
  });

  beforeEach(async () => {
    await getModules().db.exec(
      `DO $$ DECLARE r RECORD; BEGIN
         FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
           EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
         END LOOP;
       END $$`
    );
  });

  it('creates and retrieves a file by ID', async () => {
    const id = await DocumentDB.create('test-question', '/org/test-question', 'question', {
      query: 'SELECT 1',
    } as any, []);

    expect(id).toBeGreaterThan(0);

    const file = await DocumentDB.getById(id);
    expect(file).not.toBeNull();
    expect(file!.name).toBe('test-question');
    expect(file!.path).toBe('/org/test-question');
    expect(file!.type).toBe('question');
    expect((file!.content as any).query).toBe('SELECT 1');
  });

  it('retrieves a file by path', async () => {
    await DocumentDB.create('conn', '/org/database/my-db', 'connection', { type: 'duckdb', config: {} } as any, []);

    const file = await DocumentDB.getByPath('/org/database/my-db');
    expect(file).not.toBeNull();
    expect(file!.name).toBe('conn');
  });

  it('returns null for missing path', async () => {
    const file = await DocumentDB.getByPath('/org/does-not-exist');
    expect(file).toBeNull();
  });

  it('lists all files (with type filter)', async () => {
    await DocumentDB.create('q1', '/org/q1', 'question', { query: 'SELECT 1' } as any, []);
    await DocumentDB.create('q2', '/org/q2', 'question', { query: 'SELECT 2' } as any, []);
    await DocumentDB.create('dash', '/org/dash', 'dashboard', { layout: [] } as any, []);

    const questions = await DocumentDB.listAll('question');
    expect(questions.length).toBe(2);
    expect(questions.map(f => f.name).sort()).toEqual(['q1', 'q2']);
  });

  it('updates a file content', async () => {
    const id = await DocumentDB.create('orig', '/org/upd', 'question', { query: 'SELECT 1' } as any, []);

    await DocumentDB.update(id, 'renamed', '/org/upd', { query: 'SELECT 2' } as any, [], 'test-edit');

    const file = await DocumentDB.getById(id);
    expect(file!.name).toBe('renamed');
    expect((file!.content as any).query).toBe('SELECT 2');
  });

  it('deletes files by ID', async () => {
    const id = await DocumentDB.create('to-delete', '/org/del', 'question', {} as any, []);
    expect(await DocumentDB.getById(id)).not.toBeNull();

    await DocumentDB.deleteByIds([id]);
    expect(await DocumentDB.getById(id)).toBeNull();
  });

  it('assigns monotonically increasing per-org IDs', async () => {
    const id1 = await DocumentDB.create('f1', '/org/f1', 'question', {} as any, []);
    const id2 = await DocumentDB.create('f2', '/org/f2', 'question', {} as any, []);
    const id3 = await DocumentDB.create('f3', '/org/f3', 'question', {} as any, []);
    expect(id2).toBe(id1 + 1);
    expect(id3).toBe(id2 + 1);
  });

  it('filters by path prefix (listAll with pathFilters)', async () => {
    await DocumentDB.create('a', '/org/folder-a/item', 'question', {} as any, []);
    await DocumentDB.create('b', '/org/folder-b/item', 'question', {} as any, []);

    const result = await DocumentDB.listAll(undefined, ['/org/folder-a']);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('a');
  });

  it('bulk-fetches files by ID', async () => {
    const id1 = await DocumentDB.create('bulk1', '/org/bulk1', 'question', {} as any, []);
    const id2 = await DocumentDB.create('bulk2', '/org/bulk2', 'question', {} as any, []);

    const files = await DocumentDB.getByIds([id1, id2]);
    expect(files.length).toBe(2);
    expect(files.map(f => f.name).sort()).toEqual(['bulk1', 'bulk2']);
  });
});
