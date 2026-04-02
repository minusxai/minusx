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

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_file_delete_e2e.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
  };
});

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

const COMPANY_ID = 1;

function makeQuestion(): QuestionContent {
  return {
    description: '',
    query: 'SELECT 1',
    database_name: 'test',
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
    await DocumentDB.create('subfolder', '/org/subfolder', 'folder', { description: '' }, [], COMPANY_ID);
    await DocumentDB.create('configs', '/org/configs', 'folder', { description: '' }, [], COMPANY_ID);
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  it('deletes a regular file', async () => {
    const fileId = await DocumentDB.create(
      'q-to-delete', '/org/subfolder/q-to-delete', 'question', makeQuestion(), [], COMPANY_ID
    );

    const res = await deleteFile(fileId);
    expect(res.status).toBe(200);
    expect(await DocumentDB.getById(fileId, COMPANY_ID)).toBeNull();
  });

  it('deletes a folder and all its descendants', async () => {
    await DocumentDB.create('folder-to-delete', '/org/subfolder/folder-to-delete', 'folder', { description: '' }, [], COMPANY_ID);
    const childId = await DocumentDB.create(
      'child', '/org/subfolder/folder-to-delete/child', 'question', makeQuestion(), [], COMPANY_ID
    );
    const folderId = (await DocumentDB.getByPath('/org/subfolder/folder-to-delete', COMPANY_ID))!.id;

    const res = await deleteFile(folderId);
    expect(res.status).toBe(200);
    expect(await DocumentDB.getById(folderId, COMPANY_ID)).toBeNull();
    expect(await DocumentDB.getById(childId, COMPANY_ID)).toBeNull();
  });

  it('returns 404 when file does not exist', async () => {
    const res = await deleteFile(99999);
    expect(res.status).toBe(404);
  });

  it('returns 403 when trying to delete a protected file type', async () => {
    // Insert a config file directly (bypassing FilesAPI create guards) to test the delete guard
    const configId = await DocumentDB.create(
      'config.json', '/org/configs/config', 'config', {} as any, [], COMPANY_ID
    );
    const res = await deleteFile(configId);
    expect(res.status).toBe(403);
    // File must still exist
    expect(await DocumentDB.getById(configId, COMPANY_ID)).not.toBeNull();
  });
});
