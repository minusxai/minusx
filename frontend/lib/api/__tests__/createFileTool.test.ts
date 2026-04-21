/**
 * CreateFile tool handler — path conflict validation tests
 *
 * Verifies that the CreateFile tool returns a tool-level error (visible to the
 * model) when:
 *   (a) the requested folder path is already occupied by a non-folder virtual file
 *   (b) the file's final slug path duplicates another virtual file's path
 *   (c) the file's final slug path would become the parent of another virtual file
 *
 * Also verifies that:
 *   (d) creating files inside a virtual *folder* is allowed (folders are OK as parents)
 *   (e) normal creation in /org (real folder, no conflicts) succeeds
 */

import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { generateVirtualId } from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import { executeToolCall } from '@/lib/api/tool-handlers';
import type { ToolCall } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { POST as templateHandler } from '@/app/api/files/template/route';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

let testStore: any;
jest.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_AUTH_STATE = {
  user: {
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin' as UserRole,
    companyName: 'test-workspace',
    home_folder: '/org',
    mode: 'org' as Mode,
  },
  loading: false,
};

function makeStore() {
  return configureStore({
    reducer: { files: filesReducer, auth: authReducer },
    preloadedState: { auth: TEST_AUTH_STATE },
  });
}

function makeVirtualFile(overrides: Partial<{
  id: number; name: string; path: string; type: string;
}> = {}) {
  const id = overrides.id ?? generateVirtualId();
  return {
    id,
    name: overrides.name ?? 'Test File',
    path: overrides.path ?? `/org/test-${Math.abs(id)}`,
    type: overrides.type ?? 'question',
    content: {},
    references: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function createFileTool(args: Record<string, any>): ToolCall {
  return {
    id: 'tool-1',
    type: 'function',
    function: { name: 'CreateFile', arguments: args },
  };
}

function parseContent(result: { content: any }): Record<string, any> {
  const raw = result.content;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

const MOCK_DB: any = { schemas: [] };

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CreateFile tool — path conflict validation', () => {
  const dbPath = getTestDbPath('create_file_tool');

  const mockFetch = setupMockFetch({
    getPythonPort: () => 0,
    interceptors: [
      { includesUrl: ['/api/files/template'], handler: templateHandler },
    ],
  });

  beforeAll(async () => {
    await initTestDatabase(dbPath);
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  beforeEach(() => {
    testStore = makeStore();
    mockFetch.mockClear();
  });

  // -------------------------------------------------------------------------
  // (a) Folder path already occupied by a non-folder virtual file
  // -------------------------------------------------------------------------

  it('(a) returns error when folder path is occupied by a virtual dashboard', async () => {
    // Virtual dashboard at /org/Getting Started
    testStore.dispatch({
      type: 'files/setFile',
      payload: { file: makeVirtualFile({ path: '/org/Getting Started', type: 'dashboard' }), references: [] },
    });

    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org/Getting Started', name: 'My Question' }),
      MOCK_DB,
    );

    const content = parseContent(result);
    expect(content.success).toBe(false);
    expect(content.error).toMatch(/Path conflict/);
    expect(content.error).toMatch(/\/org\/Getting Started/);
    expect(content.error).toMatch(/dashboard/);
    expect(content.error).toMatch(/occupied/);
  });

  it('(a) returns error when folder path is occupied by a virtual question', async () => {
    testStore.dispatch({
      type: 'files/setFile',
      payload: { file: makeVirtualFile({ path: '/org/some-file', type: 'question' }), references: [] },
    });

    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org/some-file', name: 'Another' }),
      MOCK_DB,
    );

    const content = parseContent(result);
    expect(content.success).toBe(false);
    expect(content.error).toMatch(/Path conflict/);
    expect(content.error).toMatch(/\/org\/some-file/);
  });

  // -------------------------------------------------------------------------
  // (d) Virtual folder at the same path — must be allowed
  // -------------------------------------------------------------------------

  it('(d) succeeds when folder path is occupied by a virtual folder file', async () => {
    // Virtual folder at /org/My Folder — this is a legitimate parent
    testStore.dispatch({
      type: 'files/setFile',
      payload: { file: makeVirtualFile({ path: '/org/My Folder', type: 'folder' }), references: [] },
    });

    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org/My Folder', name: 'Inside Question' }),
      MOCK_DB,
    );

    // Should succeed (not a path conflict error)
    expect(parseContent(result).success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // (b) Final slug path duplicates an existing virtual file path
  // -------------------------------------------------------------------------

  it('(b) returns error when slugified name matches existing virtual file path', async () => {
    // Existing virtual question at /org/roi-by-campaign (slug of "ROI by Campaign")
    testStore.dispatch({
      type: 'files/setFile',
      payload: {
        file: makeVirtualFile({ path: '/org/roi-by-campaign', type: 'question' }),
        references: [],
      },
    });

    // Create another question with the same name → same slug → duplicate path
    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org', name: 'ROI by Campaign' }),
      MOCK_DB,
    );

    const content = parseContent(result);
    expect(content.success).toBe(false);
    expect(content.error).toMatch(/Path conflict/);
    expect(content.error).toMatch(/\/org\/roi-by-campaign/);
  });

  // -------------------------------------------------------------------------
  // (c) New file's path would become parent of existing virtual file
  // -------------------------------------------------------------------------

  it('(c) returns error when new file path would be parent of an existing virtual file', async () => {
    // Existing question at /org/my-folder/child
    testStore.dispatch({
      type: 'files/setFile',
      payload: {
        file: makeVirtualFile({ path: '/org/my-folder/child', type: 'question' }),
        references: [],
      },
    });

    // Now create a file named "My Folder" in /org → slug = "my-folder" → path = /org/my-folder
    // which is the parent prefix of the existing question
    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org', name: 'My Folder' }),
      MOCK_DB,
    );

    const content = parseContent(result);
    expect(content.success).toBe(false);
    expect(content.error).toMatch(/Path conflict/);
    expect(content.error).toMatch(/my-folder/);
  });

  // -------------------------------------------------------------------------
  // No conflicts — normal creation succeeds
  // -------------------------------------------------------------------------

  it('succeeds when there are no virtual file path conflicts', async () => {
    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org', name: 'Totally New Question' }),
      MOCK_DB,
    );

    expect(parseContent(result).success).toBe(true);
  });
});
