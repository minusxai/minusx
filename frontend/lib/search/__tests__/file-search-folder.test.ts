/**
 * searchFilesInFolder — integration tests against a real (seeded) document DB.
 *
 * Pins the two production bugs behind "the top-right search bar does not work":
 *   1. story/notebook/report/alert files were viewable but never searchable
 *      (missing from SEARCH_CONFIGS + the default type list).
 *   2. Search hydrated results through the full type loaders, so ONE broken
 *      context (missing versions) or a schema-less connection (live
 *      introspection) failed/hung the ENTIRE search request. Search now loads
 *      raw content ({ skipEnrichment: true }) and degrades per type.
 */
import { describe, it, expect } from 'vitest';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { searchFilesInFolder } from '@/lib/search/file-search';
import { contextLoader } from '@/lib/data/loaders/context-loader';
import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { DbFile } from '@/lib/types';

const TEST_DB_PATH = getTestDbPath('file_search_folder');

const USER: EffectiveUser = {
  userId: 1,
  email: 'x@y.z',
  name: 'X',
  role: 'admin',
  home_folder: '',
  mode: 'org',
} as unknown as EffectiveUser;

describe('searchFilesInFolder — new file types are searchable', () => {
  setupTestDb(TEST_DB_PATH);

  it('finds a story file by name with the default type list', async () => {
    await DocumentDB.create('Churn Story', '/org/Churn Story', 'story',
      { description: null, story: null, parameterValues: null } as any, [], undefined, false);

    const { results } = await searchFilesInFolder({ query: 'churn' }, USER);

    const story = results.find(r => r.type === 'story');
    expect(story).toBeDefined();
    expect(story!.name).toBe('Churn Story');
  });

  it('finds a notebook by cell content, and report/alert by name', async () => {
    await DocumentDB.create('Metrics NB', '/org/Metrics NB', 'notebook', {
      description: null,
      cells: [{
        type: 'sql', id: 'c1', name: null,
        query: 'SELECT weekly_retention FROM metrics',
        vizSettings: null, viz: null, parameters: null, parameterValues: null,
        connection_name: '',
      }],
    } as any, [], undefined, false);
    await DocumentDB.create('Retention Report', '/org/Retention Report', 'report',
      { description: null, reportPrompt: 'Summarize retention', schedule: { frequency: 'daily' }, recipients: [] } as any,
      [], undefined, false);
    await DocumentDB.create('Retention Alert', '/org/Retention Alert', 'alert',
      { description: null, tests: [], schedule: { frequency: 'daily' } } as any,
      [], undefined, false);

    const { results } = await searchFilesInFolder({ query: 'retention' }, USER);
    const types = results.map(r => r.type);
    expect(types).toContain('notebook');
    expect(types).toContain('report');
    expect(types).toContain('alert');
  });
});

describe('searchFilesInFolder — resilience', () => {
  setupTestDb(TEST_DB_PATH);

  it('a broken context (no versions) under the folder does not kill the request', async () => {
    // Unmigrated context: contextLoader THROWS on this content.
    await DocumentDB.create('bad-context', '/org/bad/context', 'context',
      {} as any, [], undefined, false);
    await DocumentDB.create('Weekly Revenue', '/org/Weekly Revenue', 'question', {
      query: 'SELECT revenue FROM sales',
      description: null,
      vizSettings: { type: 'table' },
      parameters: [],
      connection_name: '',
    } as any, [], undefined, false);

    const { results } = await searchFilesInFolder({ query: 'revenue' }, USER);
    expect(results.some(r => r.name === 'Weekly Revenue')).toBe(true);
  });

  it('searching a schema-less connection matches by name without introspecting', async () => {
    const id = await DocumentDB.create('warehouse_primary', '/org/database/warehouse_primary', 'connection',
      { type: 'nonexistent-connector-type', config: { host: 'nowhere' } } as any,
      [], undefined, false);

    const { results } = await searchFilesInFolder({ query: 'warehouse_primary' }, USER);
    expect(results.some(r => r.type === 'connection' && r.name === 'warehouse_primary')).toBe(true);

    // Proof that search never entered the introspection path: the loader's
    // refresh persists a schema stamp onto the document — search must not.
    const [stored] = await DocumentDB.getByIds([id]);
    expect((stored.content as any).schema).toBeUndefined();
  });
});

/**
 * Search is a UI surface, so it filters with `canViewFileInUI` — strictly
 * narrower than `canAccessFile`. Nothing pinned this before; these are the
 * guard for it, because search resolves its own permissions rather than
 * inheriting them from a FilesAPI call.
 */
describe('searchFilesInFolder — permission filtering', () => {
  setupTestDb(TEST_DB_PATH);

  const viewer = (overrides: Partial<EffectiveUser> = {}): EffectiveUser => ({
    userId: 2, email: 'v@y.z', name: 'V', role: 'viewer', home_folder: '', mode: 'org', ...overrides,
  } as unknown as EffectiveUser);

  it('hides accessible-but-not-viewable types (connection, context) from a viewer', async () => {
    await DocumentDB.create('acme_warehouse', '/org/database/acme_warehouse', 'connection',
      { type: 'postgres', config: { host: 'h' } } as any, [], undefined, false);
    await DocumentDB.create('acme_context', '/org/acme_context', 'context',
      { description: 'acme rules', versions: [] } as any, [], undefined, false);
    await DocumentDB.create('acme_question', '/org/acme_question', 'question',
      { description: 'acme revenue', query: 'SELECT 1' } as any, [], undefined, false);

    const asAdmin = await searchFilesInFolder({ query: 'acme' }, USER);
    expect(asAdmin.results.some(r => r.type === 'connection')).toBe(true);
    expect(asAdmin.results.some(r => r.type === 'context')).toBe(true);

    const asViewer = await searchFilesInFolder({ query: 'acme' }, viewer());
    // viewTypes excludes both for a viewer, even though allowedTypes permits them.
    expect(asViewer.results.some(r => r.type === 'connection')).toBe(false);
    expect(asViewer.results.some(r => r.type === 'context')).toBe(false);
    expect(asViewer.results.some(r => r.name === 'acme_question')).toBe(true);
  });

  it('enforces mode isolation — a tutorial file never surfaces for an org user', async () => {
    await DocumentDB.create('zebra_tutorial', '/tutorial/zebra_tutorial', 'question',
      { description: 'zebra', query: 'SELECT 1' } as any, [], undefined, false);
    await DocumentDB.create('zebra_org', '/org/zebra_org', 'question',
      { description: 'zebra', query: 'SELECT 1' } as any, [], undefined, false);

    const { results } = await searchFilesInFolder({ query: 'zebra' }, USER);
    expect(results.some(r => r.name === 'zebra_org')).toBe(true);
    expect(results.some(r => r.path.startsWith('/tutorial'))).toBe(false);
  });

  it('scopes a non-admin to their home folder', async () => {
    await DocumentDB.create('quokka_mine', '/org/team-a/quokka_mine', 'question',
      { description: 'quokka', query: 'SELECT 1' } as any, [], undefined, false);
    await DocumentDB.create('quokka_theirs', '/org/team-b/quokka_theirs', 'question',
      { description: 'quokka', query: 'SELECT 1' } as any, [], undefined, false);

    const { results } = await searchFilesInFolder(
      { query: 'quokka', folder_path: '/org' },
      viewer({ home_folder: '/org/team-a' }),
    );
    expect(results.some(r => r.name === 'quokka_mine')).toBe(true);
    expect(results.some(r => r.name === 'quokka_theirs')).toBe(false);
  });

  it("visibility: 'all' widens to canAccessFile — the LLM/MCP callers still see connections", async () => {
    await DocumentDB.create('badger_warehouse', '/org/database/badger_warehouse', 'connection',
      { type: 'postgres', config: { host: 'h' } } as any, [], undefined, false);

    const v = viewer();
    // A viewer may ACCESS a connection but not VIEW it. The two callers of this
    // branch (SearchFiles, lib/mcp/server.ts) depend on the wider one.
    const ui = await searchFilesInFolder({ query: 'badger' }, v);
    const all = await searchFilesInFolder({ query: 'badger', visibility: 'all' }, v);

    expect(ui.results.some(r => r.type === 'connection')).toBe(false);
    expect(all.results.some(r => r.name === 'badger_warehouse')).toBe(true);
  });

  it("visibility: 'all' is still bounded by canAccessFile — it is not a bypass", async () => {
    await DocumentDB.create('otter_theirs', '/org/team-b/otter_theirs', 'question',
      { description: 'otter', query: 'SELECT 1' } as any, [], undefined, false);

    const { results } = await searchFilesInFolder(
      { query: 'otter', folder_path: '/org', visibility: 'all' },
      viewer({ home_folder: '/org/team-a' }),
    );
    expect(results.some(r => r.name === 'otter_theirs')).toBe(false);
  });

  it('never leaks a connection secret into a result snippet', async () => {
    await DocumentDB.create('kestrel_db', '/org/database/kestrel_db', 'connection',
      { type: 'postgres', config: { password: 'hunter2', host: 'kestrel' } } as any,
      [], undefined, false);

    const { results } = await searchFilesInFolder({ query: 'kestrel' }, USER);
    const hit = results.find(r => r.name === 'kestrel_db');
    expect(hit).toBeDefined();
    // SEARCH_CONFIGS only scans name/path for a connection, so no config value
    // can reach a snippet — pinned here because search reads raw stored content.
    expect(JSON.stringify(hit)).not.toContain('hunter2');
  });
});

describe('loaders — skipEnrichment contract', () => {
  setupTestDb(TEST_DB_PATH);

  it('contextLoader returns the raw file (no throw) for a version-less context', async () => {
    const id = await DocumentDB.create('bad-context', '/org/bad2/context', 'context',
      { docs: [] } as any, [], undefined, false);
    const file = (await DocumentDB.getByIds([id]))[0] as DbFile;

    const loaded = await contextLoader(file, USER, { skipEnrichment: true });
    expect(loaded.id).toBe(id);
    expect((loaded.content as any).docs).toEqual([]);
  });

  it('connectionLoader skips schema introspection but still redacts config', async () => {
    const id = await DocumentDB.create('nakeddb', '/org/database/nakeddb', 'connection',
      { type: 'nonexistent-connector-type', config: { password: 'hunter2' } } as any,
      [], undefined, false);
    const file = (await DocumentDB.getByIds([id]))[0] as DbFile;

    const loaded = await connectionLoader(file, USER, { skipEnrichment: true });
    // No schema was fetched/attached…
    expect((loaded.content as any).schema).toBeUndefined();
    // …and secrets are still redacted (never serve raw config values).
    expect((loaded.content as any).config?.password).not.toBe('hunter2');
  });
});
