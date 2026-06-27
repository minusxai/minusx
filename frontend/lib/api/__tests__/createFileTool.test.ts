/**
 * CreateFile tool handler — path conflict validation tests
 *
 * Verifies that the CreateFile tool returns a tool-level error (visible to the
 * model) when:
 *   (a) the requested folder path is already occupied by a non-folder draft file
 *   (b) the file's final slug path duplicates another draft file's path
 *   (c) the file's final slug path would become the parent of another draft file
 *
 * Also verifies that:
 *   (d) creating files inside a draft *folder* is allowed (folders are OK as parents)
 *   (e) normal creation in /org (real folder, no conflicts) succeeds
 */

import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import uiReducer from '@/store/uiSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import { executeToolCall } from '@/lib/api/tool-handlers';
import type { ToolCall } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { POST as templateHandler } from '@/app/api/files/template/route';
import { POST as createFileHandler } from '@/app/api/files/route';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

let testStore: any;
vi.mock('@/store/store', () => ({
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
    reducer: { files: filesReducer, auth: authReducer, ui: uiReducer, queryResults: queryResultsReducer },
    preloadedState: { auth: TEST_AUTH_STATE },
  });
}

let draftIdCounter = 9001;
function makeDraftFile(overrides: Partial<{
  id: number; name: string; path: string; type: string;
}> = {}) {
  const id = overrides.id ?? draftIdCounter++;
  return {
    id,
    name: overrides.name ?? 'Test File',
    path: overrides.path ?? `/org/test-${id}`,
    type: overrides.type ?? 'question',
    draft: true,
    content: {},
    references: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: 1,
    last_edit_id: null,
    meta: null,
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
  // CreateFile now returns a content-block array: [ {text: json}, {text: <file_markup>…}, ...images ].
  // The JSX markup is a separate raw block — pull the JSON from the first text block.
  if (Array.isArray(raw)) return JSON.parse(raw.find((b: any) => b?.type === 'text').text);
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CreateFile tool — draft file path conflict validation', () => {
  const dbPath = getTestDbPath('create_file_tool');

  const mockFetch = setupMockFetch({
    interceptors: [
      { includesUrl: ['/api/files/template'], handler: templateHandler },
      { includesUrl: ['/api/files'], handler: createFileHandler },
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
  // (a) Folder path already occupied by a non-folder draft file
  // -------------------------------------------------------------------------

  it('(a) returns error when folder path is occupied by a draft dashboard', async () => {
    // Draft dashboard at /org/Getting Started
    testStore.dispatch({
      type: 'files/setFile',
      payload: { file: makeDraftFile({ path: '/org/Getting Started', type: 'dashboard' }), references: [] },
    });

    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org/Getting Started', name: 'My Question' }),
    );

    const content = parseContent(result);
    expect(content.success).toBe(false);
    expect(content.error).toMatch(/Path conflict/);
    expect(content.error).toMatch(/\/org\/Getting Started/);
    expect(content.error).toMatch(/dashboard/);
    expect(content.error).toMatch(/occupied/);
  });

  it('(a) returns error when folder path is occupied by a draft question', async () => {
    testStore.dispatch({
      type: 'files/setFile',
      payload: { file: makeDraftFile({ path: '/org/some-file', type: 'question' }), references: [] },
    });

    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org/some-file', name: 'Another' }),
    );

    const content = parseContent(result);
    expect(content.success).toBe(false);
    expect(content.error).toMatch(/Path conflict/);
    expect(content.error).toMatch(/\/org\/some-file/);
  });

  // -------------------------------------------------------------------------
  // (d) Draft folder at the same path — must be allowed
  // -------------------------------------------------------------------------

  it('(d) succeeds when folder path is occupied by a draft folder file', async () => {
    // First create the folder via the tool so it exists in DB (and Redux) as a real draft.
    // createDraftFile with name='My Folder' creates the folder at path /org/my-folder in DB.
    const folderResult = await executeToolCall(
      createFileTool({ file_type: 'folder', path: '/org', name: 'My Folder' }),
    );
    expect(parseContent(folderResult).success).toBe(true);

    // Now create a question inside the draft folder at its slug path — should succeed
    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org/my-folder', name: 'Inside Question' }),
    );

    // Should succeed (draft folder is OK as a parent, not a conflict)
    expect(parseContent(result).success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // (b) Final slug path duplicates an existing draft file path
  // -------------------------------------------------------------------------

  it('(b) returns error when slugified name matches existing draft file path', async () => {
    // Existing draft question at /org/roi-by-campaign (slug of "ROI by Campaign")
    testStore.dispatch({
      type: 'files/setFile',
      payload: {
        file: makeDraftFile({ path: '/org/roi-by-campaign', type: 'question' }),
        references: [],
      },
    });

    // Create another question with the same name → same slug → duplicate path
    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org', name: 'ROI by Campaign' }),
    );

    const content = parseContent(result);
    expect(content.success).toBe(false);
    expect(content.error).toMatch(/Path conflict/);
    expect(content.error).toMatch(/\/org\/roi-by-campaign/);
  });

  // -------------------------------------------------------------------------
  // (c) New file's path would become parent of existing draft file
  // -------------------------------------------------------------------------

  it('(c) returns error when new file path would be parent of an existing draft file', async () => {
    // Existing question at /org/my-folder/child
    testStore.dispatch({
      type: 'files/setFile',
      payload: {
        file: makeDraftFile({ path: '/org/my-folder/child', type: 'question' }),
        references: [],
      },
    });

    // Now create a file named "My Folder" in /org → slug = "my-folder" → path = /org/my-folder
    // which is the parent prefix of the existing question
    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org', name: 'My Folder' }),
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
    );

    expect(parseContent(result).success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Regression: `content` sent as a JSON STRING must be parsed, not spread
  // character-by-character ({ "0":"{", "1":"\n", ... } garbage with empty query).
  // -------------------------------------------------------------------------

  it('parses a stringified `content` arg instead of spreading it char-by-char', async () => {
    const content = JSON.stringify({
      query: 'SELECT 1 AS n',
      connection_name: 'static',
      vizSettings: { type: 'table' },
      parameters: [],
    });

    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org', name: 'Stringified Question', content }),
    );

    const parsed = parseContent(result);
    expect(parsed.success).toBe(true);

    const fileContent = parsed.state.fileState.content;
    expect(fileContent.query).toBe('SELECT 1 AS n'); // real query preserved
    expect(fileContent['0']).toBeUndefined();         // no char-indexed garbage
    expect(fileContent.vizSettings).toEqual({ type: 'table' });
  });

  it('rejects a non-JSON string `content` with a tool-level error', async () => {
    const result = await executeToolCall(
      createFileTool({ file_type: 'question', path: '/org', name: 'Bad Content', content: 'not json {{' }),
    );
    const parsed = parseContent(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/must be a JSON object/i);
  });

  // -------------------------------------------------------------------------
  // Validate-before-create: invalid content is rejected up front, no draft left
  // -------------------------------------------------------------------------

  it('flags invalid vizSettings as feedback (permissive: still creates the file)', async () => {
    const result = await executeToolCall(
      createFileTool({
        file_type: 'question', path: '/org', name: 'Bad Viz',
        content: {
          query: 'SELECT month, net_new_arr FROM t', connection_name: 'static',
          // the exact mistake: per-series objects in xCols/yCols (must be strings)
          vizSettings: { type: 'bar', xCols: [{ name: 'month' }], yCols: [{ name: 'net_new_arr', label: 'Net New ARR' }] },
        },
      }),
    );

    // Permissive: the file IS created and the schema issue comes back as non-blocking
    // feedback (the agent iterates; Publish is the validation gate).
    const parsed = parseContent(result);
    expect(parsed.success).toBe(true);
    expect((parsed.validation ?? []).join(' ')).toMatch(/xCols/);

    const questions = Object.values((testStore.getState() as any).files.files).filter((f: any) => f?.type === 'question');
    expect(questions).toHaveLength(1);
  });

  it('creates the draft when vizSettings are valid (string columns)', async () => {
    const result = await executeToolCall(
      createFileTool({
        file_type: 'question', path: '/org', name: 'Good Viz',
        content: {
          query: 'SELECT month, net_new_arr FROM t', connection_name: 'static',
          vizSettings: { type: 'bar', xCols: ['month'], yCols: ['net_new_arr'] },
        },
      }),
    );

    expect(parseContent(result).success).toBe(true);
    const questions = Object.values((testStore.getState() as any).files.files).filter((f: any) => f?.type === 'question');
    expect(questions).toHaveLength(1);
  });
});
