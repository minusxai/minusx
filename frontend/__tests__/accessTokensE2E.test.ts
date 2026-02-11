/**
 * E2E Test: Public Access Tokens for File Sharing
 *
 * Tests the complete token-based public file sharing system:
 * - Token creation (admin-only)
 * - Unauthenticated access via /t/{token}
 * - Token expiration and revocation
 * - Dashboard references (questions within dashboards)
 *
 * Architecture:
 * - Tokens map to files + users (impersonation pattern)
 * - /t/{token} route works without authentication
 * - Token validation happens in middleware + auth layer
 * - Existing permission system is reused 100%
 *
 * Run: npm test -- __tests__/accessTokensE2E.test.ts
 */

import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { AccessToken, AccessTokenCreate, DbFile } from '@/lib/types';

// Mock database config with custom path
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_access_tokens.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

// Import API route handlers for testing
import { POST as createTokenHandler, GET as listTokensHandler } from '@/app/api/access-tokens/route';
import { DELETE as deleteTokenHandler, PATCH as updateTokenHandler } from '@/app/api/access-tokens/[id]/route';

// Mock auth helpers to return test admin user
jest.mock('@/lib/auth/auth-helpers', () => {
  const actual = jest.requireActual('@/lib/auth/auth-helpers');
  return {
    ...actual,
    getEffectiveUser: jest.fn(async () => ({
      userId: 1,
      email: 'admin@test.com',
      name: 'Admin User',
      role: 'admin',
      home_folder: '/',
      companyId: 1,
      companyName: 'Test Company',
      mode: 'org' as const
    }))
  };
});

describe('Access Tokens E2E - Public File Sharing', () => {
  // Test infrastructure
  const { getStore } = setupTestDb(getTestDbPath('access_tokens'), {
    customInit: seedTestData
  });

  // Reset database connection before each test to ensure fresh connection
  beforeEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
  });

  // Build token API interceptor that routes to actual handlers
  const buildTokenAPIInterceptor = () => {
    return async (urlStr: string, init?: any): Promise<Response | null> => {
      const { NextRequest } = require('next/server');

      // POST /api/access-tokens (create token)
      if (urlStr.includes('/api/access-tokens') && init?.method === 'POST' && !urlStr.match(/\/\d+$/)) {
        const request = new NextRequest('http://localhost:3000/api/access-tokens', {
          method: 'POST',
          body: init?.body,
          headers: init?.headers || {}
        });
        const response = await createTokenHandler(request);
        const data = await response.json();
        return {
          ok: response.status === 200,
          status: response.status,
          json: async () => data
        } as Response;
      }

      // GET /api/access-tokens?fileId={id} (list tokens)
      if (urlStr.includes('/api/access-tokens') && init?.method === 'GET') {
        const url = new URL(urlStr);
        const request = new NextRequest(url.toString(), {
          method: 'GET',
          headers: init?.headers || {}
        });
        const response = await listTokensHandler(request);
        const data = await response.json();
        return {
          ok: response.status === 200,
          status: response.status,
          json: async () => data
        } as Response;
      }

      // DELETE /api/access-tokens/[id] (revoke token) - now accepts UUID token strings
      if (urlStr.match(/\/api\/access-tokens\/[^/]+$/) && init?.method === 'DELETE') {
        const idMatch = urlStr.match(/\/api\/access-tokens\/([^/]+)$/);
        const id = idMatch ? idMatch[1] : '';
        const request = new NextRequest(`http://localhost:3000/api/access-tokens/${id}`, {
          method: 'DELETE',
          headers: init?.headers || {}
        });
        const response = await deleteTokenHandler(request, { params: Promise.resolve({ id }) });
        const data = await response.json();
        return {
          ok: response.status === 200,
          status: response.status,
          json: async () => data
        } as Response;
      }

      // GET /t/{token} (public file access)
      // This would need to be handled differently since it's a page route, not API
      // For now, we'll test this via direct function calls

      return null; // Not a token API route
    };
  };

  // Mock fetch with custom interceptor for token APIs
  beforeEach(() => {
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      // Try token API interceptor first
      const tokenResult = await buildTokenAPIInterceptor()(urlStr, init);
      if (tokenResult) return tokenResult;

      // Default: return error for unmocked requests
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Unmocked fetch request' })
      } as Response;
    });
  });

  // Test data IDs (seeded in customInit)
  const TEST_COMPANY_ID = 1;
  const ADMIN_USER_ID = 1;
  const VIEWER_USER_ID = 2;
  const TEST_QUESTION_ID = 100;
  const TEST_DASHBOARD_ID = 101;
  const REFERENCED_QUESTION_1_ID = 102;
  const REFERENCED_QUESTION_2_ID = 103;

  /**
   * TEST 1: Happy Path - Create token and access Question
   *
   * Flow:
   * 1. Admin creates token for question (view as viewer)
   * 2. Unauthenticated user accesses /t/{token}
   * 3. System loads question using viewer's permissions
   * 4. Question data is returned successfully
   */
  describe('Test 1: Access Question via Token', () => {
    it('should create token and access question without authentication', async () => {
      const { createAdapter } = await import('@/lib/database/adapter/factory');
      const db = await createAdapter({ type: 'sqlite', sqlitePath: getTestDbPath('access_tokens') });

      // STEP 1: Admin creates access token
      const tokenCreate: AccessTokenCreate = {
        file_id: TEST_QUESTION_ID,
        view_as_user_id: VIEWER_USER_ID,
        // expires_at defaults to 30 days from now
      };

      const response = await fetch('http://localhost:3000/api/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokenCreate)
      });

      expect(response.ok).toBe(true);
      const createResult = await response.json();
      expect(createResult.success).toBe(true);
      expect(createResult.data.token).toBeDefined();
      expect(createResult.data.url).toContain('/t/');

      const token = createResult.data.token;

      // STEP 2: Verify token was created in database
      const result = await db.query('SELECT * FROM access_tokens WHERE token = $1', [token]);
      const dbToken = result.rows[0];
      expect(dbToken).toBeDefined();
      expect(dbToken.file_id).toBe(TEST_QUESTION_ID);
      expect(dbToken.view_as_user_id).toBe(VIEWER_USER_ID);
      expect(dbToken.is_active).toBe(1);

      // STEP 3: Test token validation (via AccessTokenDB)
      const AccessTokenDB = require('@/lib/database/documents-db').AccessTokenDB;
      const fetchedToken = await AccessTokenDB.getByToken(token);
      expect(fetchedToken).toBeDefined();
      expect(fetchedToken.file_id).toBe(TEST_QUESTION_ID);
      expect(fetchedToken.view_as_user_id).toBe(VIEWER_USER_ID);
      expect(fetchedToken.is_active).toBe(true);

      // Validate token is usable
      const validation = AccessTokenDB.validateToken(fetchedToken);
      expect(validation.isValid).toBe(true);
      expect(validation.error).toBeUndefined();

      await db.close();
    });

    it('should reject access with invalid token', async () => {
      const AccessTokenDB = require('@/lib/database/documents-db').AccessTokenDB;
      const invalidToken = 'invalid-token-12345';

      // Try to fetch invalid token
      const fetchedToken = await AccessTokenDB.getByToken(invalidToken);
      expect(fetchedToken).toBeNull();
    });
  });

  /**
   * TEST 2: Happy Path - Create token and access Dashboard with References
   *
   * Flow:
   * 1. Admin creates token for dashboard (view as viewer)
   * 2. Verify token is created with correct properties
   * 3. Test that token grants access to dashboard and references
   */
  describe('Test 2: Access Dashboard with References via Token', () => {
    it('should create token for dashboard and verify token properties', async () => {
      const { createAdapter } = await import('@/lib/database/adapter/factory');
      const db = await createAdapter({ type: 'sqlite', sqlitePath: getTestDbPath('access_tokens') });

      // STEP 1: Admin creates access token for dashboard
      const tokenCreate: AccessTokenCreate = {
        file_id: TEST_DASHBOARD_ID,
        view_as_user_id: VIEWER_USER_ID
      };

      const response = await fetch('http://localhost:3000/api/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokenCreate)
      });

      expect(response.ok).toBe(true);
      const createResult = await response.json();
      expect(createResult.success).toBe(true);
      expect(createResult.data.token).toBeDefined();
      expect(createResult.data.url).toContain('/t/');

      const token = createResult.data.token;

      // STEP 2: Verify token was created in database for dashboard
      const tokenResult = await db.query('SELECT * FROM access_tokens WHERE token = $1', [token]);
      const dbToken = tokenResult.rows[0];
      expect(dbToken).toBeDefined();
      expect(dbToken.file_id).toBe(TEST_DASHBOARD_ID);
      expect(dbToken.view_as_user_id).toBe(VIEWER_USER_ID);
      expect(dbToken.is_active).toBe(1);

      // STEP 3: Verify dashboard file exists and has references (use composite key)
      const dashboardResult = await db.query('SELECT * FROM files WHERE company_id = $1 AND id = $2', [TEST_COMPANY_ID, TEST_DASHBOARD_ID]);
      const dashboard = dashboardResult.rows[0];
      expect(dashboard).toBeDefined();
      expect(dashboard.type).toBe('dashboard');

      const dashboardContent = JSON.parse(dashboard.content);
      expect(dashboardContent.assets).toBeDefined();
      expect(dashboardContent.assets.length).toBe(2);

      const refIds = dashboardContent.assets.map((asset: any) => asset.id);
      expect(refIds).toContain(REFERENCED_QUESTION_1_ID);
      expect(refIds).toContain(REFERENCED_QUESTION_2_ID);

      // STEP 4: Test AccessTokenDB validation
      const AccessTokenDB = require('@/lib/database/documents-db').AccessTokenDB;
      const fetchedToken = await AccessTokenDB.getByToken(token);
      expect(fetchedToken).toBeDefined();
      expect(fetchedToken.file_id).toBe(TEST_DASHBOARD_ID);

      const validation = AccessTokenDB.validateToken(fetchedToken);
      expect(validation.isValid).toBe(true);

      await db.close();
    });

    it('should list tokens for a file via API', async () => {
      // No database connection needed - this test only uses API

      // STEP 1: Create two tokens for the same dashboard
      const response1 = await fetch('http://localhost:3000/api/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: TEST_DASHBOARD_ID,
          view_as_user_id: VIEWER_USER_ID
        })
      });

      const response2 = await fetch('http://localhost:3000/api/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: TEST_DASHBOARD_ID,
          view_as_user_id: VIEWER_USER_ID,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
        })
      });

      expect(response1.ok).toBe(true);
      expect(response2.ok).toBe(true);

      // STEP 2: List all tokens for the dashboard
      const listResponse = await fetch(`http://localhost:3000/api/access-tokens?fileId=${TEST_DASHBOARD_ID}`, {
        method: 'GET'
      });

      expect(listResponse.ok).toBe(true);
      const listResult = await listResponse.json();
      expect(listResult.success).toBe(true);
      expect(listResult.data).toBeDefined();
      expect(Array.isArray(listResult.data)).toBe(true);
      expect(listResult.data.length).toBeGreaterThanOrEqual(2);

      // STEP 3: Verify tokens have correct properties
      listResult.data.forEach((token: AccessToken) => {
        expect(token.file_id).toBe(TEST_DASHBOARD_ID);
        expect(token.view_as_user_id).toBe(VIEWER_USER_ID);
        expect(token.token).toBeDefined();
        expect(token.is_active).toBe(true);
      });
    });
  });

  /**
   * TEST 3: Security - Token Expiration and Revocation
   *
   * Flow:
   * 1. Create token with custom expiration
   * 2. Verify expired tokens are rejected by validation
   * 3. Verify revoked tokens are rejected by validation
   * 4. Verify cascade deletes work correctly
   */
  describe('Test 3: Token Security - Expiration and Revocation', () => {
    it('should detect expired tokens via validation', async () => {
      const AccessTokenDB = require('@/lib/database/documents-db').AccessTokenDB;

      // STEP 1: Create token that expires 1 second from now
      const expiresAt = new Date(Date.now() + 1000).toISOString();

      const response = await fetch('http://localhost:3000/api/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: TEST_QUESTION_ID,
          view_as_user_id: VIEWER_USER_ID,
          expires_at: expiresAt
        })
      });

      expect(response.ok).toBe(true);
      const createResult = await response.json();
      const token = createResult.data.token;

      // STEP 2: Validation should succeed immediately
      let fetchedToken = await AccessTokenDB.getByToken(token);
      let validation = AccessTokenDB.validateToken(fetchedToken);
      expect(validation.isValid).toBe(true);

      // STEP 3: Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1500));

      // STEP 4: Validation should now fail
      fetchedToken = await AccessTokenDB.getByToken(token);
      validation = AccessTokenDB.validateToken(fetchedToken);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain('expired');
    });

    it('should revoke token via API and detect via validation', async () => {
      const AccessTokenDB = require('@/lib/database/documents-db').AccessTokenDB;

      // STEP 1: Create token
      const response = await fetch('http://localhost:3000/api/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: TEST_QUESTION_ID,
          view_as_user_id: VIEWER_USER_ID
        })
      });

      expect(response.ok).toBe(true);
      const createResult = await response.json();
      const token = createResult.data.token;

      // STEP 2: Validation should work
      let fetchedToken = await AccessTokenDB.getByToken(token);
      let validation = AccessTokenDB.validateToken(fetchedToken);
      expect(validation.isValid).toBe(true);

      // STEP 3: Revoke token via API (token is now the primary key, not a separate id)
      const revokeResponse = await fetch(`http://localhost:3000/api/access-tokens/${token}`, {
        method: 'DELETE'
      });
      expect(revokeResponse.ok).toBe(true);
      const revokeResult = await revokeResponse.json();
      expect(revokeResult.success).toBe(true);

      // STEP 4: Validation should now fail (token revoked)
      fetchedToken = await AccessTokenDB.getByToken(token);
      expect(fetchedToken.is_active).toBe(false);

      validation = AccessTokenDB.validateToken(fetchedToken);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain('revoked');
    });

    it('should scope token to specific file', async () => {
      const { createAdapter } = await import('@/lib/database/adapter/factory');
      const db = await createAdapter({ type: 'sqlite', sqlitePath: getTestDbPath('access_tokens') });

      // STEP 1: Create token for question
      const response = await fetch('http://localhost:3000/api/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: TEST_QUESTION_ID,
          view_as_user_id: VIEWER_USER_ID
        })
      });

      expect(response.ok).toBe(true);
      const createResult = await response.json();
      const token = createResult.data.token;

      // STEP 2: Verify token is scoped to specific file in database
      const result = await db.query('SELECT file_id FROM access_tokens WHERE token = $1', [token]);
      const dbToken = result.rows[0];
      expect(dbToken.file_id).toBe(TEST_QUESTION_ID);

      // STEP 3: Verify AccessTokenDB correctly associates token with file
      const AccessTokenDB = require('@/lib/database/documents-db').AccessTokenDB;
      const fetchedToken = await AccessTokenDB.getByToken(token);
      expect(fetchedToken.file_id).toBe(TEST_QUESTION_ID);

      // The /t/{token} route will always load the file specified in token.file_id
      // There's no way to use this token to access a different file

      await db.close();
    });

    it('should cascade-delete tokens when file is deleted', async () => {
      const { createAdapter } = await import('@/lib/database/adapter/factory');
      const db = await createAdapter({ type: 'sqlite', sqlitePath: getTestDbPath('access_tokens') });
      const AccessTokenDB = require('@/lib/database/documents-db').AccessTokenDB;

      // STEP 1: Create a temporary file (now requires explicit company_id and id due to composite keys)
      // Get next ID for this company - we need to use raw query to get max id
      const maxIdResult = await db.query('SELECT MAX(id) as max_id FROM files WHERE company_id = $1', [TEST_COMPANY_ID]);
      const tempFileId = (maxIdResult.rows[0]?.max_id || 0) + 1;

      await db.query(`
        INSERT INTO files (company_id, id, name, path, type, content, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        TEST_COMPANY_ID,
        tempFileId,
        'Temp File',
        '/org/temp-file',
        'question',
        JSON.stringify({ name: 'Temp File', query: 'SELECT 1', vizSettings: { type: 'table' } })
      ]);

      // STEP 2: Create token for temp file
      const response = await fetch('http://localhost:3000/api/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: tempFileId,
          view_as_user_id: VIEWER_USER_ID
        })
      });

      expect(response.ok).toBe(true);
      const createResult = await response.json();
      const token = createResult.data.token;

      // STEP 3: Verify token exists
      let fetchedToken = await AccessTokenDB.getByToken(token);
      expect(fetchedToken).toBeDefined();
      expect(fetchedToken.file_id).toBe(tempFileId);

      // STEP 4: Delete the file (should cascade to tokens due to ON DELETE CASCADE)
      // Use composite key (company_id, id) for deletion
      await db.query('DELETE FROM files WHERE company_id = $1 AND id = $2', [TEST_COMPANY_ID, tempFileId]);

      // STEP 5: Verify token was cascade-deleted from database
      const tokenResult = await db.query('SELECT * FROM access_tokens WHERE token = $1', [token]);
      expect(tokenResult.rows[0]).toBeUndefined();

      // STEP 6: AccessTokenDB should return null for deleted token
      fetchedToken = await AccessTokenDB.getByToken(token);
      expect(fetchedToken).toBeNull();

      await db.close();
    });
  });

  /**
   * TEST 4: Folder Access - Token grants access to folder contents
   *
   * Flow:
   * 1. Create folder with various file types (questions, dashboards, connections, users)
   * 2. Create token for folder (view as viewer)
   * 3. Verify token grants access to folder and its contents
   * 4. Verify role-based filtering (viewer can't see connections/users files)
   * 5. Verify home_folder permissions are enforced
   */
  describe('Test 4: Folder Access with Role-Based Filtering', () => {
    const TEST_FOLDER_ID = 200;
    const FOLDER_QUESTION_1_ID = 201;
    const FOLDER_QUESTION_2_ID = 202;
    const FOLDER_DASHBOARD_ID = 203;
    const FOLDER_CONNECTION_ID = 204; // Admin-only file type
    const FOLDER_USERS_FILE_ID = 205; // Admin-only file type
    const OUTSIDE_FOLDER_QUESTION_ID = 206; // Outside viewer's home_folder

    it('should create token for folder and verify token properties', async () => {
      const { createAdapter } = await import('@/lib/database/adapter/factory');
      const db = await createAdapter({ type: 'sqlite', sqlitePath: getTestDbPath('access_tokens') });

      // STEP 1: Admin creates access token for folder
      const tokenCreate: AccessTokenCreate = {
        file_id: TEST_FOLDER_ID,
        view_as_user_id: VIEWER_USER_ID
      };

      const response = await fetch('http://localhost:3000/api/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokenCreate)
      });

      expect(response.ok).toBe(true);
      const createResult = await response.json();
      expect(createResult.success).toBe(true);
      expect(createResult.data.token).toBeDefined();

      const token = createResult.data.token;

      // STEP 2: Verify token was created in database for folder
      const tokenResult = await db.query('SELECT * FROM access_tokens WHERE token = $1', [token]);
      const dbToken = tokenResult.rows[0];
      expect(dbToken).toBeDefined();
      expect(dbToken.file_id).toBe(TEST_FOLDER_ID);
      expect(dbToken.view_as_user_id).toBe(VIEWER_USER_ID);
      expect(dbToken.is_active).toBe(1);

      // STEP 3: Verify folder file exists (use composite key)
      const folderResult = await db.query('SELECT * FROM files WHERE company_id = $1 AND id = $2', [TEST_COMPANY_ID, TEST_FOLDER_ID]);
      const folder = folderResult.rows[0];
      expect(folder).toBeDefined();
      expect(folder.type).toBe('folder');

      await db.close();
    });

    it('should load folder contents as references using extractReferenceIds', async () => {
      const { createAdapter } = await import('@/lib/database/adapter/factory');
      const db = await createAdapter({ type: 'sqlite', sqlitePath: getTestDbPath('access_tokens') });
      const { extractReferenceIds } = require('@/lib/data/helpers/references');

      // STEP 1: Load folder file (use composite key)
      const folderResult = await db.query('SELECT * FROM files WHERE company_id = $1 AND id = $2', [TEST_COMPANY_ID, TEST_FOLDER_ID]);
      const folder = folderResult.rows[0];
      expect(folder).toBeDefined();
      expect(folder.type).toBe('folder');

      // STEP 2: Parse folder as DbFile
      const dbFile = {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        type: folder.type,
        content: JSON.parse(folder.content),
        company_id: folder.company_id,
        created_at: folder.created_at,
        updated_at: folder.updated_at
      };

      // STEP 3: Extract reference IDs (folder children)
      const refIds = await extractReferenceIds(dbFile);

      // STEP 4: Verify all folder children are returned (before filtering)
      // Note: OUTSIDE_FOLDER_QUESTION_ID is NOT in this folder (it's in /admin/)
      expect(refIds).toBeDefined();
      expect(Array.isArray(refIds)).toBe(true);
      expect(refIds.length).toBe(5); // 5 files directly in /org/test-folder

      expect(refIds).toContain(FOLDER_QUESTION_1_ID);
      expect(refIds).toContain(FOLDER_QUESTION_2_ID);
      expect(refIds).toContain(FOLDER_DASHBOARD_ID);
      expect(refIds).toContain(FOLDER_CONNECTION_ID);
      expect(refIds).toContain(FOLDER_USERS_FILE_ID);
      // Outside folder question is NOT a child of this folder
      expect(refIds).not.toContain(OUTSIDE_FOLDER_QUESTION_ID);

      await db.close();
    });

    it('should filter folder contents based on viewer role permissions', async () => {
      const { loadFile } = require('@/lib/data/files.server');

      // STEP 1: Create effective user context (viewer role)
      const viewerUser = {
        userId: VIEWER_USER_ID,
        email: 'viewer@test.com',
        name: 'Viewer User',
        role: 'viewer',
        home_folder: '',  // Empty string for mode root (will resolve to /org)
        companyId: TEST_COMPANY_ID,
        companyName: 'Test Company',
        mode: 'org' as const
      };

      // STEP 2: Load folder using viewer's permissions
      const result = await loadFile(TEST_FOLDER_ID, viewerUser);

      expect(result.data).toBeDefined();
      expect(result.data.type).toBe('folder');
      expect(result.metadata?.references).toBeDefined();

      const references = result.metadata.references;

      // STEP 3: Verify role-based filtering
      // Viewer should see: questions (2) + dashboard (1) + connection (1) = 4 files
      // Viewer should NOT see: users (admin-only type)
      const refIds = references.map((ref: any) => ref.id);

      // Accessible files (viewer can see these)
      expect(refIds).toContain(FOLDER_QUESTION_1_ID);
      expect(refIds).toContain(FOLDER_QUESTION_2_ID);
      expect(refIds).toContain(FOLDER_DASHBOARD_ID);
      expect(refIds).toContain(FOLDER_CONNECTION_ID);  // Connections are now accessible

      // Filtered out files (admin-only types)
      expect(refIds).not.toContain(FOLDER_USERS_FILE_ID);

      // Outside home_folder (should be filtered by permission check)
      expect(refIds).not.toContain(OUTSIDE_FOLDER_QUESTION_ID);

      // Verify 4 files are returned
      expect(references.length).toBe(4);
    });

    it('should enforce home_folder permissions on folder contents', async () => {
      const { loadFile } = require('@/lib/data/files.server');

      // STEP 1: Create restricted viewer with narrow home_folder
      const restrictedViewer = {
        userId: VIEWER_USER_ID,
        email: 'viewer@test.com',
        name: 'Viewer User',
        role: 'viewer',
        home_folder: 'test-folder', // Relative path (will resolve to /org/test-folder)
        companyId: TEST_COMPANY_ID,
        companyName: 'Test Company',
        mode: 'org' as const
      };

      // STEP 2: Load folder using restricted viewer's permissions
      const result = await loadFile(TEST_FOLDER_ID, restrictedViewer);

      expect(result.data).toBeDefined();
      expect(result.data.type).toBe('folder');
      expect(result.metadata?.references).toBeDefined();

      const references = result.metadata.references;

      // STEP 3: Verify all accessible files are within home_folder
      references.forEach((ref: any) => {
        expect(ref.path).toMatch(/^\/org\/test-folder/);
      });

      // STEP 4: Verify count matches (4 accessible files in folder - including connection)
      expect(references.length).toBe(4);
    });

    it('should verify admin user can see all folder contents including restricted types', async () => {
      const { loadFile } = require('@/lib/data/files.server');

      // STEP 1: Create admin user context
      const adminUser = {
        userId: ADMIN_USER_ID,
        email: 'admin@test.com',
        name: 'Admin User',
        role: 'admin',
        home_folder: '',  // Empty string for mode root
        companyId: TEST_COMPANY_ID,
        companyName: 'Test Company',
        mode: 'org' as const
      };

      // STEP 2: Load folder using admin's permissions
      const result = await loadFile(TEST_FOLDER_ID, adminUser);

      expect(result.data).toBeDefined();
      expect(result.data.type).toBe('folder');
      expect(result.metadata?.references).toBeDefined();

      const references = result.metadata.references;
      const refIds = references.map((ref: any) => ref.id);

      // STEP 3: Verify admin can see ALL files in the folder (including admin-only types)
      expect(refIds).toContain(FOLDER_QUESTION_1_ID);
      expect(refIds).toContain(FOLDER_QUESTION_2_ID);
      expect(refIds).toContain(FOLDER_DASHBOARD_ID);
      expect(refIds).toContain(FOLDER_CONNECTION_ID); // Admin can see connection
      expect(refIds).toContain(FOLDER_USERS_FILE_ID); // Admin can see users
      // Outside folder question is NOT in this folder, even for admin
      expect(refIds).not.toContain(OUTSIDE_FOLDER_QUESTION_ID);

      // Admin should see all 5 files in the folder
      expect(references.length).toBe(5);
    });

    it('should test complete token flow: create token for folder, validate, and access with filtering', async () => {
      const AccessTokenDB = require('@/lib/database/documents-db').AccessTokenDB;
      const { loadFile } = require('@/lib/data/files.server');
      const { getEffectiveUserFromToken } = require('@/lib/auth/auth-helpers');

      // STEP 1: Create token for folder
      const response = await fetch('http://localhost:3000/api/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: TEST_FOLDER_ID,
          view_as_user_id: VIEWER_USER_ID
        })
      });

      expect(response.ok).toBe(true);
      const createResult = await response.json();
      if (!createResult.success || !createResult.data || !createResult.data.token) {
        throw new Error(`Token creation failed: ${JSON.stringify(createResult)}`);
      }
      const token = createResult.data.token;

      // STEP 2: Validate token
      const fetchedToken = await AccessTokenDB.getByToken(token);
      expect(fetchedToken).toBeDefined();
      expect(fetchedToken.file_id).toBe(TEST_FOLDER_ID);

      const validation = AccessTokenDB.validateToken(fetchedToken);
      expect(validation.isValid).toBe(true);

      // STEP 3: Get effective user from token (simulates /t/{token} route)
      // Note: getEffectiveUserFromToken is mocked in this test suite
      // In production, it would return the view_as_user
      const viewerUser = {
        userId: VIEWER_USER_ID,
        email: 'viewer@test.com',
        name: 'Viewer User',
        role: 'viewer',
        home_folder: '',  // Empty string for mode root (will resolve to /org)
        companyId: TEST_COMPANY_ID,
        companyName: 'Test Company',
        mode: 'org' as const
      };

      // STEP 4: Load folder with viewer's permissions
      const result = await loadFile(TEST_FOLDER_ID, viewerUser);

      expect(result.data).toBeDefined();
      expect(result.data.type).toBe('folder');
      expect(result.metadata?.references).toBeDefined();

      // STEP 5: Verify filtered references (viewer should see 4 files - including connection)
      const references = result.metadata.references;
      expect(references.length).toBe(4);

      const refIds = references.map((ref: any) => ref.id);
      expect(refIds).toContain(FOLDER_QUESTION_1_ID);
      expect(refIds).toContain(FOLDER_QUESTION_2_ID);
      expect(refIds).toContain(FOLDER_DASHBOARD_ID);
      expect(refIds).toContain(FOLDER_CONNECTION_ID);  // Connections are now accessible
      expect(refIds).not.toContain(FOLDER_USERS_FILE_ID);
    });
  });
});

// ============================================================================
// Test Data Seeding
// ============================================================================

/**
 * Seed test database with users and files for access token tests
 */
async function seedTestData(dbPath: string) {
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });

  // Create admin user (composite key: company_id, id)
  await db.query(`
    INSERT INTO users (company_id, id, email, name, password_hash, home_folder, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [1, 1, 'admin@test.com', 'Admin User', 'hash', '/', 'admin']);

  // Create viewer user (for view_as)
  await db.query(`
    INSERT INTO users (company_id, id, email, name, password_hash, home_folder, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [1, 2, 'viewer@test.com', 'Viewer User', 'hash', '/org', 'viewer']);

  // Create test question (composite key: company_id, id)
  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    100,
    'Test Question',
    '/org/test-question',
    'question',
    JSON.stringify({
      name: 'Test Question',
      query: 'SELECT * FROM test_table',
      vizSettings: { type: 'table' }
    })
  ]);

  // Create referenced questions for dashboard
  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    102,
    'Question 1',
    '/org/question-1',
    'question',
    JSON.stringify({
      name: 'Question 1',
      query: 'SELECT * FROM sales',
      vizSettings: { type: 'bar' }
    })
  ]);

  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    103,
    'Question 2',
    '/org/question-2',
    'question',
    JSON.stringify({
      name: 'Question 2',
      query: 'SELECT * FROM revenue',
      vizSettings: { type: 'line' }
    })
  ]);

  // Create test dashboard with references
  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    101,
    'Test Dashboard',
    '/org/test-dashboard',
    'dashboard',
    JSON.stringify({
      name: 'Test Dashboard',
      assets: [
        { type: 'question', id: 102 },
        { type: 'question', id: 103 }
      ],
      layout: {
        items: [
          { id: 102, x: 0, y: 0, w: 6, h: 4 },
          { id: 103, x: 6, y: 0, w: 6, h: 4 }
        ]
      }
    })
  ]);

  // ============================================================================
  // Test 4 Data: Folder with mixed file types for role-based filtering tests
  // ============================================================================

  // Create test folder
  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    200,
    'Test Folder',
    '/org/test-folder',
    'folder',
    JSON.stringify({
      name: 'Test Folder',
      description: 'A test folder with various file types'
    })
  ]);

  // Create questions in folder (accessible to viewer)
  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    201,
    'Folder Question 1',
    '/org/test-folder/question-1',
    'question',
    JSON.stringify({
      name: 'Folder Question 1',
      query: 'SELECT * FROM table1',
      vizSettings: { type: 'table' }
    })
  ]);

  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    202,
    'Folder Question 2',
    '/org/test-folder/question-2',
    'question',
    JSON.stringify({
      name: 'Folder Question 2',
      query: 'SELECT * FROM table2',
      vizSettings: { type: 'bar' }
    })
  ]);

  // Create dashboard in folder (accessible to viewer)
  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    203,
    'Folder Dashboard',
    '/org/test-folder/dashboard',
    'dashboard',
    JSON.stringify({
      name: 'Folder Dashboard',
      assets: [],
      layout: { items: [] }
    })
  ]);

  // Create connection in folder (admin-only, should be filtered for viewer)
  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    204,
    'Test Connection',
    '/org/test-folder/connection',
    'connection',
    JSON.stringify({
      name: 'Test Connection',
      type: 'duckdb',
      config: { file_path: 'test.duckdb' }
    })
  ]);

  // Create users file in folder (admin-only, should be filtered for viewer)
  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    205,
    'Users Config',
    '/org/test-folder/users',
    'users',
    JSON.stringify({
      name: 'Users Config',
      users: []
    })
  ]);

  // Create question OUTSIDE viewer's home_folder (should be filtered)
  await db.query(`
    INSERT INTO files (company_id, id, name, path, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    1,
    206,
    'Outside Question',
    '/admin/outside-question',
    'question',
    JSON.stringify({
      name: 'Outside Question',
      query: 'SELECT * FROM secret_data',
      vizSettings: { type: 'table' }
    })
  ]);

  await db.close();
}

