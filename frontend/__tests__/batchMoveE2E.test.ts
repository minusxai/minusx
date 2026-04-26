/**
 * E2E Tests: Move file operations
 *
 * Covers two endpoints that share the same underlying move logic:
 *   - PATCH /api/files/[id]  (metadata-only path: content === undefined)
 *   - POST  /api/files/batch-move
 *
 * TDD contract:
 *   - Blue  → existing behaviour passes before any refactor
 *   - Red   → tests fail after gutting DocumentDB from routes (before data-layer impl)
 *   - Blue  → all pass once moveFile/batchMoveFiles land in FilesDataLayerServer
 *
 * New behaviour added in this pass (starts RED, turns GREEN after implementation):
 *   - batch-move rejects moves when destination parent folder does not exist
 *     (files/[id] already checks this; batch-move did not — now brought to parity)
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must appear before any imports
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { NextRequest } from 'next/server';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent } from '@/lib/types';
import { PATCH as filePatchHandler } from '@/app/api/files/[id]/route';
import { POST as batchMoveHandler } from '@/app/api/files/batch-move/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuestion(description = 'test'): QuestionContent {
  return {
    description,
    query: 'SELECT 1',
    connection_name: 'test_db',
    parameters: [],
    vizSettings: { type: 'table' },
  };
}

async function patchMove(fileId: number, name: string, newPath: string) {
  const req = new NextRequest(`http://localhost:3000/api/files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, path: newPath }),
    headers: { 'Content-Type': 'application/json' },
  });
  // params can be awaited as a plain object (awaiting a non-promise returns the value)
  return filePatchHandler(req, { params: { id: String(fileId) } as any });
}

async function batchMove(files: Array<{ id: number; name: string; destFolder: string }>) {
  const req = new NextRequest('http://localhost:3000/api/files/batch-move', {
    method: 'POST',
    body: JSON.stringify({ files }),
    headers: { 'Content-Type': 'application/json' },
  });
  return batchMoveHandler(req);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Move operations E2E', () => {
  const dbPath = getTestDbPath('batch_move_e2e');

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    // Seed additional folders needed across all tests — must be non-draft so
    // move handler can verify destination parent exists via getByPath.
    await DocumentDB.create('source', '/org/source', 'folder', { description: '' }, [], undefined, false);
    await DocumentDB.create('dest', '/org/dest', 'folder', { description: '' }, [], undefined, false);
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/files/[id] — metadata-only move
  // -------------------------------------------------------------------------

  describe('PATCH /api/files/[id] — metadata-only move', () => {
    it('moves a regular file to a new path', async () => {
      const fileId = await DocumentDB.create(
        'q-patch-move', '/org/source/q-patch-move', 'question', makeQuestion(), []
      );

      const res = await patchMove(fileId, 'q-patch-moved', '/org/dest/q-patch-moved');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toMatchObject({
        id: fileId,
        name: 'q-patch-moved',
        path: '/org/dest/q-patch-moved',
        oldPath: '/org/source/q-patch-move',
      });

      // Verify DB reflects the new path
      const updated = await DocumentDB.getById(fileId);
      expect(updated?.path).toBe('/org/dest/q-patch-moved');
      expect(updated?.name).toBe('q-patch-moved');
    });

    it('moves a folder and all its descendants', async () => {
      // Create a folder with two children
      const folderId = await DocumentDB.create('move-folder', '/org/source/move-folder', 'folder', { description: '' }, [], undefined, false);
      const child1Id = await DocumentDB.create(
        'child-1', '/org/source/move-folder/child-1', 'question', makeQuestion(), [], undefined, false
      );
      const child2Id = await DocumentDB.create(
        'child-2', '/org/source/move-folder/child-2', 'question', makeQuestion(), [], undefined, false
      );
      const res = await patchMove(folderId, 'moved-folder', '/org/dest/moved-folder');
      expect(res.status).toBe(200);

      // Folder itself moved
      const folder = await DocumentDB.getById(folderId);
      expect(folder?.path).toBe('/org/dest/moved-folder');

      // Children paths updated too
      const c1 = await DocumentDB.getById(child1Id);
      const c2 = await DocumentDB.getById(child2Id);
      expect(c1?.path).toBe('/org/dest/moved-folder/child-1');
      expect(c2?.path).toBe('/org/dest/moved-folder/child-2');
    });

    it('returns 404 when file does not exist', async () => {
      const res = await patchMove(99999, 'ghost', '/org/dest/ghost');
      expect(res.status).toBe(404);
    });

    it('returns 400 when destination parent folder does not exist', async () => {
      const fileId = await DocumentDB.create(
        'q-no-parent', '/org/source/q-no-parent', 'question', makeQuestion(), []
      );
      const res = await patchMove(fileId, 'q-no-parent', '/org/nonexistent/q-no-parent');
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/files/batch-move
  // -------------------------------------------------------------------------

  describe('POST /api/files/batch-move', () => {
    it('moves multiple regular files in one request', async () => {
      const id1 = await DocumentDB.create(
        'batch-q1', '/org/source/batch-q1', 'question', makeQuestion(), []
      );
      const id2 = await DocumentDB.create(
        'batch-q2', '/org/source/batch-q2', 'question', makeQuestion(), []
      );

      const res = await batchMove([
        { id: id1, name: 'batch-q1', destFolder: '/org/dest' },
        { id: id2, name: 'batch-q2', destFolder: '/org/dest' },
      ]);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: id1, path: '/org/dest/batch-q1' }),
          expect.objectContaining({ id: id2, path: '/org/dest/batch-q2' }),
        ])
      );

      // Verify DB
      expect((await DocumentDB.getById(id1))?.path).toBe('/org/dest/batch-q1');
      expect((await DocumentDB.getById(id2))?.path).toBe('/org/dest/batch-q2');
    });

    it('moves a folder and all its descendants via batch-move', async () => {
      const folderId = await DocumentDB.create('batch-folder', '/org/source/batch-folder', 'folder', { description: '' }, [], undefined, false);
      const childId = await DocumentDB.create(
        'batch-child', '/org/source/batch-folder/batch-child', 'question', makeQuestion(), [], undefined, false
      );

      const res = await batchMove([{ id: folderId, name: 'batch-folder', destFolder: '/org/dest' }]);
      expect(res.status).toBe(200);

      expect((await DocumentDB.getById(folderId))?.path).toBe('/org/dest/batch-folder');
      expect((await DocumentDB.getById(childId))?.path).toBe('/org/dest/batch-folder/batch-child');
    });

    it('returns 404 when a file in the batch does not exist', async () => {
      const res = await batchMove([{ id: 99999, name: 'ghost', destFolder: '/org/dest' }]);
      expect(res.status).toBe(404);
    });

    it('returns 400 when destination parent folder does not exist', async () => {
      // NEW behaviour — batch-move previously skipped this check; data-layer enforces it
      const fileId = await DocumentDB.create(
        'batch-no-parent', '/org/source/batch-no-parent', 'question', makeQuestion(), []
      );
      const res = await batchMove([{ id: fileId, name: 'batch-no-parent', destFolder: '/org/nonexistent' }]);
      expect(res.status).toBe(400);
    });

    it('returns 400 when request body is empty', async () => {
      const res = await batchMove([]);
      expect(res.status).toBe(400);
    });
  });
});
