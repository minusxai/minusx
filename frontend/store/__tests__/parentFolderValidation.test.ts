/**
 * Parent Folder Validation E2E Tests
 *
 * Verifies that files and folders cannot be created or moved into non-existent
 * parent folder paths. All tests in the "should reject" group are expected to
 * FAIL before the fix is applied (the API currently returns 2xx with no check).
 *
 * Coverage:
 *   1. POST /api/files          — create file in missing parent → 400
 *   2. POST /api/folders        — create folder in missing parent → 400
 *   3. PATCH /api/files/[id]    — full save with path moved to missing parent → 400
 *   4. PATCH /api/files/[id]    — metadata-only path change to missing parent → 400
 *   + happy-path for each branch (parent exists → 2xx)
 */

import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent, UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import { POST as filePostHandler } from '@/app/api/files/route';
import { PATCH as filePatchHandler } from '@/app/api/files/[id]/route';
import { POST as folderPostHandler } from '@/app/api/folders/route';

// ---------------------------------------------------------------------------
// Jest module mocks — hoisted to top by Jest
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuestionContent(): QuestionContent {
  return {
    description: 'Test question',
    query: 'SELECT 1',
    connection_name: 'test_db',
    parameters: [],
    vizSettings: { type: 'table' },
  };
}

async function callFilePost(body: object) {
  const { NextRequest } = require('next/server');
  const req = new NextRequest('http://localhost:3000/api/files', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return filePostHandler(req);
}

async function callFolderPost(folderName: string, parentPath: string) {
  const { NextRequest } = require('next/server');
  const req = new NextRequest('http://localhost:3000/api/folders', {
    method: 'POST',
    body: JSON.stringify({ folderName, parentPath }),
    headers: { 'Content-Type': 'application/json' },
  });
  return folderPostHandler(req);
}

async function callFilePatch(fileId: number, body: object) {
  const { NextRequest } = require('next/server');
  const req = new NextRequest(`http://localhost:3000/api/files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return filePatchHandler(req, { params: { id: String(fileId) } });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Parent folder validation', () => {
  const dbPath = getTestDbPath('parent_folder_validation');

  beforeAll(async () => {
    // initTestDatabase now seeds /org folder document automatically.
    await initTestDatabase(dbPath);
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  // -------------------------------------------------------------------------
  // 1. POST /api/files
  // -------------------------------------------------------------------------

  describe('POST /api/files — file creation', () => {
    it('rejects creating a file when parent folder does not exist', async () => {
      const res = await callFilePost({
        name: 'my-question',
        path: '/org/nonexistent-folder/my-question',
        type: 'question',
        content: makeQuestionContent(),
        references: [],
      });
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(JSON.stringify(data)).toMatch(/parent folder/i);
    });

    it('allows creating a file when parent folder exists', async () => {
      const res = await callFilePost({
        name: 'my-question',
        path: '/org/my-question',
        type: 'question',
        content: makeQuestionContent(),
        references: [],
      });
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // 2. POST /api/folders
  // -------------------------------------------------------------------------

  describe('POST /api/folders — folder creation', () => {
    it('rejects creating a folder when parent folder does not exist', async () => {
      const res = await callFolderPost('sub-folder', '/org/nonexistent-parent');
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(JSON.stringify(data)).toMatch(/parent folder/i);
    });

    it('allows creating a folder when parent folder exists', async () => {
      const res = await callFolderPost('new-folder', '/org');
      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // 3. PATCH /api/files/[id] — full save (with content) path change
  // -------------------------------------------------------------------------

  describe('PATCH /api/files/[id] — full save with path change', () => {
    let fileId: number;

    beforeAll(async () => {
      fileId = await DocumentDB.create(
        'patch-test-question',
        '/org/patch-test-question',
        'question',
        makeQuestionContent(),
        []
      );
    });

    it('rejects full save when new path has non-existent parent', async () => {
      const res = await callFilePatch(fileId, {
        name: 'patch-test-question',
        path: '/org/nonexistent-folder/patch-test-question',
        content: { ...makeQuestionContent(), description: 'updated' },
        references: [],
      });
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(JSON.stringify(data)).toMatch(/parent folder/i);
    });

    it('allows full save when path stays in existing parent', async () => {
      const res = await callFilePatch(fileId, {
        name: 'patch-test-question',
        path: '/org/patch-test-question',
        content: { ...makeQuestionContent(), description: 'updated' },
        references: [],
      });
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // 4. PATCH /api/files/[id] — metadata-only (no content) path change
  // -------------------------------------------------------------------------

  describe('PATCH /api/files/[id] — metadata-only path change', () => {
    let fileId: number;
    let subFolderId: number;

    beforeAll(async () => {
      fileId = await DocumentDB.create(
        'meta-test-question',
        '/org/meta-test-question',
        'question',
        makeQuestionContent(),
        []
      );
      subFolderId = await DocumentDB.create(
        'existing-sub',
        '/org/existing-sub',
        'folder',
        { description: '' },
        []
      );
    });

    it('rejects metadata-only rename when new path has non-existent parent', async () => {
      const res = await callFilePatch(fileId, {
        name: 'meta-test-question',
        path: '/org/nonexistent-folder/meta-test-question',
        // no content field → metadata-only branch
      });
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(JSON.stringify(data)).toMatch(/parent folder/i);
    });

    it('allows metadata-only rename when new parent folder exists', async () => {
      const res = await callFilePatch(fileId, {
        name: 'meta-test-question',
        path: '/org/existing-sub/meta-test-question',
        // no content field → metadata-only branch
      });
      expect(res.status).toBe(200);
    });
  });
});
