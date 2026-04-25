/**
 * E2E Tests: DELETE /api/files/[id]
 *
 * TDD Blue → Red → Blue:
 *   Blue  — these pass against current DocumentDB-in-route implementation
 *   Red   — fail after gutting DocumentDB from DELETE handler
 *   Blue  — pass once deleteFile lands in FilesDataLayerServer
 */

// ---------------------------------------------------------------------------
// Hoisted mocks
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
import { DELETE as fileDeleteHandler } from '@/app/api/files/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DELETE /api/files/[id]', () => {
  const dbPath = getTestDbPath('file_delete_e2e');

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    await DocumentDB.create('subfolder', '/org/subfolder', 'folder', { description: '' }, []);
    // /org/configs is created by initTestDatabase via workspace-template.json
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

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
    // Use a unique path to avoid conflicting with the template-seeded /org/configs/config
    const configId = await DocumentDB.create(
      'config-protected', '/org/configs/config-protected', 'config', {} as any, []
    );
    const res = await deleteFile(configId);
    expect(res.status).toBe(403);
    // File must still exist
    expect(await DocumentDB.getById(configId)).not.toBeNull();
  });
});
