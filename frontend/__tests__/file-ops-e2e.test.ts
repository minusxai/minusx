/**
 * E2E Tests: file move + delete operations (merged from batchMoveE2E +
 * fileDeleteE2E — identical db-config mock + initTestDatabase harness, so they
 * share one DB init/seed and one module-import load).
 */

import { NextRequest } from 'next/server';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent } from '@/lib/types';
import { PATCH as filePatchHandler, DELETE as fileDeleteHandler } from '@/app/api/files/[id]/route';
import { POST as batchMoveHandler } from '@/app/api/files/batch-move/route';

const dbPath = getTestDbPath('file_ops_e2e');

describe('file ops E2E', () => {
  beforeAll(async () => {
    await initTestDatabase(dbPath);
    // Folders used across the move + delete suites (non-draft so move/delete
    // handlers can verify the destination/parent exists via getByPath).
    await DocumentDB.create('source', '/org/source', 'folder', { description: '' }, [], undefined, false);
    await DocumentDB.create('dest', '/org/dest', 'folder', { description: '' }, [], undefined, false);
    await DocumentDB.create('subfolder', '/org/subfolder', 'folder', { description: '' }, [], undefined, false);
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  describe('Move operations E2E', () => {
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

        const updated = await DocumentDB.getById(fileId);
        expect(updated?.path).toBe('/org/dest/q-patch-moved');
        expect(updated?.name).toBe('q-patch-moved');
      });

      it('moves a folder and all its descendants', async () => {
        const folderId = await DocumentDB.create('move-folder', '/org/source/move-folder', 'folder', { description: '' }, [], undefined, false);
        const child1Id = await DocumentDB.create(
          'child-1', '/org/source/move-folder/child-1', 'question', makeQuestion(), [], undefined, false
        );
        const child2Id = await DocumentDB.create(
          'child-2', '/org/source/move-folder/child-2', 'question', makeQuestion(), [], undefined, false
        );
        const res = await patchMove(folderId, 'moved-folder', '/org/dest/moved-folder');
        expect(res.status).toBe(200);

        const folder = await DocumentDB.getById(folderId);
        expect(folder?.path).toBe('/org/dest/moved-folder');

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

  describe('DELETE /api/files/[id]', () => {
    function makeQuestion(): QuestionContent {
      return {
        description: '',
        query: 'SELECT 1',
        connection_name: 'test',
        parameters: [],
        vizSettings: { type: 'table' },
      };
    }

    async function deleteFile(fileId: number) {
      const req = new NextRequest(`http://localhost:3000/api/files/${fileId}`, {
        method: 'DELETE',
      });
      return fileDeleteHandler(req, { params: { id: String(fileId) } as any });
    }

    it('deletes a regular file', async () => {
      const fileId = await DocumentDB.create(
        'q-to-delete', '/org/subfolder/q-to-delete', 'question', makeQuestion(), []
      );

      const res = await deleteFile(fileId);
      expect(res.status).toBe(200);
      expect(await DocumentDB.getById(fileId)).toBeNull();
    });

    it('deletes a folder and all its descendants', async () => {
      const folderId = await DocumentDB.create('folder-to-delete', '/org/subfolder/folder-to-delete', 'folder', { description: '' }, []);
      const childId = await DocumentDB.create(
        'child', '/org/subfolder/folder-to-delete/child', 'question', makeQuestion(), []
      );
      // Publish child so cascade delete (which uses listAll/draft=false filter) can find it
      await DocumentDB.update(childId, 'child', '/org/subfolder/folder-to-delete/child', makeQuestion(), [], 'init-child');

      const res = await deleteFile(folderId);
      expect(res.status).toBe(200);
      expect(await DocumentDB.getById(folderId)).toBeNull();
      expect(await DocumentDB.getById(childId)).toBeNull();
    });

    it('returns 404 when file does not exist', async () => {
      const res = await deleteFile(99999);
      expect(res.status).toBe(404);
    });

    it('returns 403 when trying to delete a protected file type', async () => {
      const configId = await DocumentDB.create(
        'config-protected', '/org/configs/config-protected', 'config', {} as any, []
      );
      const res = await deleteFile(configId);
      expect(res.status).toBe(403);
      expect(await DocumentDB.getById(configId)).not.toBeNull();
    });
  });
});
