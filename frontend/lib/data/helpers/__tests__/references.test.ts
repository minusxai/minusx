/**
 * References Helper Tests
 *
 * Tests extractReferenceIds / extractAllReferenceIds for all file types.
 * These tests cover the behaviour that must survive the refactor away from
 * direct DocumentDB usage in references.ts.
 *
 * Run: npm test -- references.test.ts
 */

import { DocumentDB } from '@/lib/database/documents-db';
import { extractReferenceIds, extractAllReferenceIds, ChildIdResolver } from '@/lib/data/helpers/references';
import {
  initTestDatabase,
  cleanupTestDatabase,
  getTestDbPath,
} from '@/store/__tests__/test-utils';

// Database-specific mock — must be at module top level (Jest hoisting)
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_references_helper.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
  };
});

const TEST_DB_PATH = getTestDbPath('references_helper');
const COMPANY_ID = 1;

/** Real DB-backed resolver — mirrors the one in files.server.ts */
const childResolver: ChildIdResolver = async (folderPath, companyId) => {
  const children = await DocumentDB.listAll(companyId, undefined, [folderPath], 1, false);
  return children.map(c => c.id);
};

/** Stub resolver — should never be called for non-folder tests */
const noopResolver: ChildIdResolver = async () => {
  throw new Error('childResolver should not be called for non-folder types');
};

beforeAll(async () => {
  await initTestDatabase(TEST_DB_PATH);
});

afterAll(async () => {
  await cleanupTestDatabase(TEST_DB_PATH);
});

// ---------------------------------------------------------------------------
// Document types — return cached references column directly
// ---------------------------------------------------------------------------

describe('extractReferenceIds — document types', () => {
  it('returns cached references for a dashboard', async () => {
    const q1 = await DocumentDB.create('RefQ1', '/org/refq1', 'question', { query: 'SELECT 1' }, [], COMPANY_ID);
    const q2 = await DocumentDB.create('RefQ2', '/org/refq2', 'question', { query: 'SELECT 2' }, [], COMPANY_ID);
    const dashId = await DocumentDB.create('RefDash', '/org/refdash', 'dashboard', {}, [q1, q2], COMPANY_ID);
    const dash = await DocumentDB.getById(dashId, COMPANY_ID);

    const refIds = await extractReferenceIds(dash!, noopResolver);

    expect(refIds).toEqual(expect.arrayContaining([q1, q2]));
    expect(refIds).toHaveLength(2);
  });

  it('returns empty array for a question with no references', async () => {
    const id = await DocumentDB.create('RefQNoRef', '/org/refqnoref', 'question', { query: 'SELECT 1' }, [], COMPANY_ID);
    const file = await DocumentDB.getById(id, COMPANY_ID);

    expect(await extractReferenceIds(file!, noopResolver)).toEqual([]);
  });

  it('returns cached references for a notebook', async () => {
    const child = await DocumentDB.create('RefNBChild', '/org/refnbchild', 'question', {}, [], COMPANY_ID);
    const id = await DocumentDB.create('RefNB', '/org/refnb', 'notebook', {}, [child], COMPANY_ID);
    const file = await DocumentDB.getById(id, COMPANY_ID);

    expect(await extractReferenceIds(file!, noopResolver)).toEqual([child]);
  });

  it('returns cached references for a report', async () => {
    const child = await DocumentDB.create('RefRptChild', '/org/refrptchild', 'question', {}, [], COMPANY_ID);
    const id = await DocumentDB.create('RefRpt', '/org/refrpt', 'report', {}, [child], COMPANY_ID);
    const file = await DocumentDB.getById(id, COMPANY_ID);

    expect(await extractReferenceIds(file!, noopResolver)).toEqual([child]);
  });

  it('returns cached references for a presentation', async () => {
    const child = await DocumentDB.create('RefPrsChild', '/org/refprschild', 'question', {}, [], COMPANY_ID);
    const id = await DocumentDB.create('RefPrs', '/org/refprs', 'presentation', {}, [child], COMPANY_ID);
    const file = await DocumentDB.getById(id, COMPANY_ID);

    expect(await extractReferenceIds(file!, noopResolver)).toEqual([child]);
  });
});

// ---------------------------------------------------------------------------
// Folder type — queries DB for direct children
// ---------------------------------------------------------------------------

describe('extractReferenceIds — folder type', () => {
  it('returns IDs of direct children only (depth = 1)', async () => {
    const folderId = await DocumentDB.create('RefFolder', '/org/reffolder', 'folder', {}, [], COMPANY_ID);
    const child1 = await DocumentDB.create('RefC1', '/org/reffolder/c1', 'question', {}, [], COMPANY_ID);
    const child2 = await DocumentDB.create('RefC2', '/org/reffolder/c2', 'question', {}, [], COMPANY_ID);
    // Grandchild — must NOT appear
    await DocumentDB.create('RefGC', '/org/reffolder/c1/gc', 'question', {}, [], COMPANY_ID);
    const folder = await DocumentDB.getById(folderId, COMPANY_ID);

    const refIds = await extractReferenceIds(folder!, childResolver);

    expect(refIds).toEqual(expect.arrayContaining([child1, child2]));
    expect(refIds).toHaveLength(2);
  });

  it('excludes the folder itself from the result', async () => {
    const folderId = await DocumentDB.create('RefFolderSelf', '/org/reffolderself', 'folder', {}, [], COMPANY_ID);
    await DocumentDB.create('RefSelfChild', '/org/reffolderself/ch', 'question', {}, [], COMPANY_ID);
    const folder = await DocumentDB.getById(folderId, COMPANY_ID);

    const refIds = await extractReferenceIds(folder!, childResolver);

    expect(refIds).not.toContain(folderId);
  });

  it('returns empty array for an empty folder', async () => {
    const folderId = await DocumentDB.create('RefEmptyFolder', '/org/refemptyfolder', 'folder', {}, [], COMPANY_ID);
    const folder = await DocumentDB.getById(folderId, COMPANY_ID);

    expect(await extractReferenceIds(folder!, childResolver)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractAllReferenceIds — deduplication across multiple files
// ---------------------------------------------------------------------------

describe('extractAllReferenceIds', () => {
  it('deduplicates IDs referenced by multiple files', async () => {
    const shared = await DocumentDB.create('RefShared', '/org/refshared', 'question', {}, [], COMPANY_ID);
    const d1Id = await DocumentDB.create('RefD1', '/org/refd1', 'dashboard', {}, [shared], COMPANY_ID);
    const d2Id = await DocumentDB.create('RefD2', '/org/refd2', 'dashboard', {}, [shared], COMPANY_ID);
    const d1 = await DocumentDB.getById(d1Id, COMPANY_ID);
    const d2 = await DocumentDB.getById(d2Id, COMPANY_ID);

    const refIds = await extractAllReferenceIds([d1!, d2!], noopResolver);

    // shared appears in both dashboards but must appear only once
    expect(refIds.filter(id => id === shared)).toHaveLength(1);
  });

  it('returns empty array when all files have no references', async () => {
    const id1 = await DocumentDB.create('RefNoRef1', '/org/refnoref1', 'question', {}, [], COMPANY_ID);
    const id2 = await DocumentDB.create('RefNoRef2', '/org/refnoref2', 'question', {}, [], COMPANY_ID);
    const f1 = await DocumentDB.getById(id1, COMPANY_ID);
    const f2 = await DocumentDB.getById(id2, COMPANY_ID);

    expect(await extractAllReferenceIds([f1!, f2!], noopResolver)).toEqual([]);
  });
});
