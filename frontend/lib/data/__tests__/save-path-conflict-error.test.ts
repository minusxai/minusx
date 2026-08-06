/**
 * Saving a file onto a path a published file already occupies must surface the
 * server's actionable message ("… already exists … rename …") as a
 * UserFacingError — that is the type the save UIs (FileHeader,
 * ContextContainerV2) display verbatim; anything untyped collapses to the
 * generic "An unexpected error occurred" toast, which tells the user nothing.
 *
 * Runs the CLIENT data layer against the REAL route handlers in-process, so
 * the whole chain is covered: DocumentDB's unique-index translation →
 * handleApiError serialization → client deserialization.
 */
import { getTestDbPath, initTestDatabase, cleanupTestDatabase, mkPublished } from '@/store/__tests__/test-utils';
import { FilesAPI } from '@/lib/data/files';
import { isUserFacingError } from '@/lib/errors';
import type { BaseFileContent, QuestionContent } from '@/lib/types';
import { POST as batchSaveHandler } from '@/app/api/files/batch-save/route';
import { PATCH as filePatchHandler } from '@/app/api/files/[id]/route';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { NextRequest } from 'next/server';

const dbPath = getTestDbPath('save_path_conflict_error');
const content = {
  description: 'q',
  query: 'SELECT 1',
  connection_name: 'test_db',
  parameters: [],
  vizSettings: { type: 'table' },
} as QuestionContent as BaseFileContent;

const mockFetch = setupMockFetch({
  interceptors: [
    { includesUrl: ['/api/files/batch-save'], handler: batchSaveHandler },
  ],
  additionalInterceptors: [
    async (urlStr, init) => {
      const m = urlStr.match(/\/api\/files\/(\d+)(?:\?|$)/);
      if (!m) return null;
      const id = m[1];
      const req = new NextRequest(`http://localhost:3000/api/files/${id}`, {
        method: init?.method || 'PATCH',
        body: init?.body,
        headers: init?.headers,
      });
      const res = await filePatchHandler(req, { params: { id } as any });
      const data = await res.json();
      return { ok: res.status === 200, status: res.status, json: async () => data } as Response;
    },
  ],
});

describe('path-conflict save errors reach the UI as user-facing', () => {
  let occupiedId: number;
  let draftAId: number;
  let draftBId: number;

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    occupiedId = await mkPublished('Owner', '/org/taken-spot', 'question', content, []);
    draftAId = await mkPublished('Contender A', '/org/spot-a', 'question', content, []);
    draftBId = await mkPublished('Contender B', '/org/spot-b', 'question', content, []);
  }, 120000);

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  }, 60000);

  // Braces matter: mockClear() returns the mock, and a function returned from
  // beforeEach is treated by vitest as a teardown hook — which would invoke
  // the fetch mock with no arguments.
  beforeEach(() => { mockFetch.mockClear(); });

  it('batchSaveFiles (the Save button path) throws a UserFacingError telling the user to rename', async () => {
    let thrown: unknown;
    try {
      await FilesAPI.batchSaveFiles([
        { id: draftAId, name: 'Contender A', path: '/org/taken-spot', content, references: [] },
      ]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as Error).message).toMatch(/already exists/i);
    expect((thrown as Error).message).toMatch(/rename/i);
    expect(isUserFacingError(thrown)).toBe(true);
  });

  it('saveFile (single-file path) throws the same user-facing error', async () => {
    let thrown: unknown;
    try {
      await FilesAPI.saveFile(draftBId, 'Contender B', '/org/taken-spot', content, []);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as Error).message).toMatch(/already exists/i);
    expect(isUserFacingError(thrown)).toBe(true);
  });
});
