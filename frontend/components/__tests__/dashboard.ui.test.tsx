/**
 * Dashboard UI tests — organized by scenario.
 *
 * Each describe block covers one user-facing scenario and contains both the
 * manual (user interaction) and agentic (agent-driven) versions side by side.
 *
 * Scenarios:
 *   1. Add question to existing dashboard and save
 *   2. Create new dashboard + question, then publishAll
 *   3. Edit/cancel mode toggle  (manual only — no agentic equivalent)
 *
 * Infrastructure (shared across all manual describes):
 * - makeStore() creates a fresh Redux store per test
 * - jest.spyOn(storeModule, 'getStore') aligns all utility code (loadFiles,
 *   publishFile, editFile) with the same store the Provider uses
 * - global.fetch is mocked inline — no Python backend required
 */

// Must be hoisted before any module imports
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: ':memory:',
  DB_DIR: '.',
  getDbType: () => 'sqlite',
  DB_TYPE: 'sqlite',
}));

import React from 'react';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as storeModule from '@/store/store';
import { setFile, setEdit, addQuestionToDashboard, selectDirtyFiles } from '@/store/filesSlice';
import { setDashboardEditMode } from '@/store/uiSlice';
import { publishAll } from '@/lib/api/file-state';
import type { DashboardContent } from '@/lib/types.gen';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import FileHeader from '@/components/FileHeader';
import DashboardContainerV2 from '@/components/containers/DashboardContainerV2';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const DASHBOARD_ID = 1;
const QUESTION_ID = 2;
const QUESTION_NAME = 'Sales Revenue';

function makeDashboardDbFile() {
  return {
    id: DASHBOARD_ID,
    name: 'Test Dashboard',
    type: 'dashboard' as const,
    path: '/org/Test Dashboard',
    content: { assets: [], layout: null },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
    company_id: 1,
  };
}

function makeQuestionDbFile() {
  return {
    id: QUESTION_ID,
    name: QUESTION_NAME,
    type: 'question' as const,
    path: `/org/${QUESTION_NAME}`,
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, database_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
    company_id: 1,
  };
}

function makeUpdatedDashboardDbFile() {
  return {
    ...makeDashboardDbFile(),
    content: { assets: [{ type: 'question', id: QUESTION_ID }], layout: null },
    updated_at: new Date().toISOString(),
  };
}

/**
 * Standard fetch mock for tests that render the dashboard UI:
 *   GET  /api/files?type=question  → QuestionBrowserPanel list
 *   PATCH /api/files/:id           → save dashboard
 */
function mockDashboardFetch() {
  global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method?.toUpperCase() ?? 'GET';

    if (method === 'GET' && url.includes('/api/files') && url.includes('type=question')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: QUESTION_ID, name: QUESTION_NAME, type: 'question', path: `/org/${QUESTION_NAME}` }],
        }),
      };
    }

    if (method === 'PATCH' && url.includes(`/api/files/${DASHBOARD_ID}`)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: makeUpdatedDashboardDbFile() }),
      };
    }

    return { ok: true, status: 200, json: async () => ({ data: null }) };
  });
}

// ============================================================================
// Scenario 1: Add question to existing dashboard and save
// ============================================================================

describe('Add question to existing dashboard and save', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: true }));
    mockDashboardFetch();
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('manual: adds question to empty dashboard and saves via Publish button', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <>
        <FileHeader fileId={DASHBOARD_ID} fileType="dashboard" />
        <DashboardContainerV2 fileId={DASHBOARD_ID} />
      </>,
      { store: testStore }
    );

    // Dashboard is in edit mode with no questions — QuestionBrowserPanel is shown
    // inline. Wait for the panel to populate, find the question card, click Add.
    const questionCard = await screen.findByRole('article', { name: QUESTION_NAME }, { timeout: 5000 });
    const addButton = within(questionCard).getByRole('button', { name: 'Add to dashboard' });
    await user.click(addButton);

    // Redux: dashboard is now dirty with the new asset
    await waitFor(() => {
      const fileState = testStore.getState().files.files[DASHBOARD_ID];
      const merged = {
        ...(fileState.content as DashboardContent),
        ...(fileState.persistableChanges as Partial<DashboardContent> | undefined),
      };
      expect(merged.assets?.some(a => (a as { id: number }).id === QUESTION_ID)).toBe(true);
    }, { timeout: 3000 });

    // "Publish changes" button is now enabled
    const publishBtn = screen.getByRole('button', { name: 'Publish changes' });
    expect(publishBtn).not.toBeDisabled();
    await user.click(publishBtn);

    // After save: clearEdits fires → persistableChanges is empty
    await waitFor(() => {
      const fileState = testStore.getState().files.files[DASHBOARD_ID];
      expect(Object.keys(fileState.persistableChanges ?? {})).toHaveLength(0);
    }, { timeout: 5000 });

    // Confirm the PATCH was issued exactly once
    const saveCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes(`/api/files/${DASHBOARD_ID}`) &&
        init?.method?.toUpperCase() === 'PATCH'
    );
    expect(saveCalls).toHaveLength(1);
  });

  // agentic: TBD — step 3
});

// ============================================================================
// Scenario 2: Create new dashboard and question, then publishAll
// ============================================================================

describe('Create new dashboard and question, then publishAll', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    // No pre-seeded files — each test creates its own virtual files
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('manual: publishAll saves virtual question first, then virtual dashboard with resolved references', async () => {
    const Q_VID = -1;
    const DASH_VID = -2;
    const REAL_Q_ID = 10;
    const REAL_DASH_ID = 11;
    const Q_NAME = 'Revenue Query';
    const DASH_NAME = 'New Dashboard';

    // Seed virtual files (negative IDs) into Redux
    testStore.dispatch(setFile({
      file: {
        id: Q_VID,
        name: Q_NAME,
        type: 'question' as const,
        path: `/org/${Q_NAME}`,
        content: { query: '', vizSettings: { type: 'table' as const }, database_name: '' },
        created_at: '',
        updated_at: '',
        references: [] as number[],
        version: 1,
        last_edit_id: null,
        company_id: 1,
      },
      references: [],
    }));
    testStore.dispatch(setFile({
      file: {
        id: DASH_VID,
        name: DASH_NAME,
        type: 'dashboard' as const,
        path: `/org/${DASH_NAME}`,
        content: { assets: [], layout: null },
        created_at: '',
        updated_at: '',
        references: [] as number[],
        version: 1,
        last_edit_id: null,
        company_id: 1,
      },
      references: [],
    }));

    // Make the question dirty; link it to the dashboard
    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT revenue FROM sales', vizSettings: { type: 'table' as const }, database_name: 'default' },
    }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASH_VID, questionId: Q_VID }));

    // Track batch-create calls to verify save order
    const batchCreateBodies: Array<{ files: Array<{ virtualId: number; type: string; content: unknown }> }> = [];

    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';

      if (method === 'POST' && url.includes('/api/files/batch-create')) {
        const body = JSON.parse(init?.body as string) as typeof batchCreateBodies[number];
        batchCreateBodies.push(body);

        if (batchCreateBodies.length === 1) {
          // First call: question (no virtual deps)
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{
                virtualId: Q_VID,
                file: {
                  id: REAL_Q_ID, name: Q_NAME, type: 'question',
                  path: `/org/${Q_NAME}`,
                  content: { query: 'SELECT revenue FROM sales', vizSettings: { type: 'table' }, database_name: 'default' },
                  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                  references: [], version: 1, last_edit_id: null, company_id: 1,
                },
              }],
            }),
          };
        }

        // Second call: dashboard (after replaceVirtualIds resolves Q_VID → REAL_Q_ID)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{
              virtualId: DASH_VID,
              file: {
                id: REAL_DASH_ID, name: DASH_NAME, type: 'dashboard',
                path: `/org/${DASH_NAME}`,
                content: { assets: [{ type: 'question', id: REAL_Q_ID }], layout: { columns: 12, items: [] } },
                created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                references: [REAL_Q_ID], version: 1, last_edit_id: null, company_id: 1,
              },
            }],
          }),
        };
      }

      return { ok: true, status: 200, json: async () => ({ data: null }) };
    });

    await act(async () => { await publishAll(); });

    // Two separate batch-create calls — one per topological level
    expect(batchCreateBodies).toHaveLength(2);

    // Call 1: question only (no unresolved virtual refs)
    const firstFiles = batchCreateBodies[0].files;
    expect(firstFiles).toHaveLength(1);
    expect(firstFiles[0].virtualId).toBe(Q_VID);
    expect(firstFiles[0].type).toBe('question');

    // Call 2: dashboard whose assets already carry the REAL question ID
    const secondFiles = batchCreateBodies[1].files;
    expect(secondFiles).toHaveLength(1);
    expect(secondFiles[0].virtualId).toBe(DASH_VID);
    expect(secondFiles[0].type).toBe('dashboard');
    const savedDashContent = secondFiles[0].content as DashboardContent;
    expect(savedDashContent.assets?.some(a => (a as { id: number }).id === REAL_Q_ID)).toBe(true);

    // No dirty files remain after publishAll
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });

  // agentic: TBD — step 3
});

// ============================================================================
// Scenario 3: Edit/cancel mode toggle  (manual only)
// ============================================================================

describe('Dashboard edit/cancel mode toggle', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    mockDashboardFetch();
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('manual: enters and exits edit mode via the Edit / Cancel toggle', async () => {
    const user = userEvent.setup();

    // Start in view mode
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: false }));

    renderWithProviders(
      <>
        <FileHeader fileId={DASHBOARD_ID} fileType="dashboard" />
        <DashboardContainerV2 fileId={DASHBOARD_ID} />
      </>,
      { store: testStore }
    );

    expect(await screen.findByRole('region', { name: 'Dashboard' })).toBeInTheDocument();

    // Enter edit mode
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBe(true);

    // Exit edit mode
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBe(false);
  });
});
