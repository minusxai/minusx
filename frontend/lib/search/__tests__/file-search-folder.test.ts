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
