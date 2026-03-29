/**
 * Scenario 1: Manual dashboard UI interactions
 *
 * Tests the full user flow:
 *   Dashboard opens in edit mode
 *   → QuestionBrowserPanel shows available questions
 *   → User clicks "Add <question name> to dashboard"
 *   → User clicks "Publish changes" (the save button for dashboards)
 *   → Redux state confirms the save completed (isDirty becomes false)
 *
 * Infrastructure:
 * - makeStore() creates a fresh Redux store per test
 * - jest.spyOn(storeModule, 'getStore') aligns all utility code (loadFiles,
 *   publishFile, editFile) with the same store the Provider uses
 * - global.fetch is mocked for the two API calls that happen during the flow:
 *     GET  /api/files?type=question  (QuestionBrowserPanel question list)
 *     PATCH /api/files/1             (save dashboard)
 * - No Python backend required — API responses are mocked inline
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
// Helpers
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Dashboard UI — manual interactions', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    // Fresh store per test — aligned with getStore() via spy
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    // Pre-seed files so useFile() finds them without fetching
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));

    // Start in edit mode (mimics user clicking Edit or agent making changes)
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: true }));

    // Mock fetch for the two API calls that happen during the flow
    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';

      // QuestionBrowserPanel: GET /api/files?paths=...&type=question&depth=999
      if (method === 'GET' && url.includes('/api/files') && url.includes('type=question')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: QUESTION_ID, name: QUESTION_NAME, type: 'question', path: `/org/${QUESTION_NAME}` }],
          }),
        };
      }

      // Save dashboard: PATCH /api/files/1
      if (method === 'PATCH' && url.includes(`/api/files/${DASHBOARD_ID}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makeUpdatedDashboardDbFile() }),
        };
      }

      // Fallback — should not be reached in this test
      return { ok: true, status: 200, json: async () => ({ data: null }) };
    });
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('adds a question to an empty dashboard and saves', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <>
        <FileHeader fileId={DASHBOARD_ID} fileType="dashboard" />
        <DashboardContainerV2 fileId={DASHBOARD_ID} />
      </>,
      { store: testStore }
    );

    // Dashboard renders in edit mode; since it has no questions the
    // QuestionBrowserPanel is rendered inline as empty-state.
    // Wait for the panel to load the available question list then locate the
    // question card by its name, and the "Add to dashboard" button within it.
    const questionCard = await screen.findByRole(
      'article',
      { name: QUESTION_NAME },
      { timeout: 5000 }
    );
    const addButton = within(questionCard).getByRole('button', { name: 'Add to dashboard' });

    // Add the question
    await user.click(addButton);

    // Redux state: dashboard should now be dirty with the new asset
    await waitFor(() => {
      const fileState = testStore.getState().files.files[DASHBOARD_ID];
      const merged = {
        ...(fileState.content as DashboardContent),
        ...(fileState.persistableChanges as Partial<DashboardContent> | undefined),
      };
      expect(merged.assets?.some(a => (a as { id: number }).id === QUESTION_ID)).toBe(true);
    }, { timeout: 3000 });

    // The "Publish changes" button (aria-label on dashboards) should be visible now
    const publishBtn = screen.getByRole('button', { name: 'Publish changes' });
    expect(publishBtn).not.toBeDisabled();

    // Save
    await user.click(publishBtn);

    // After save: publishFile dispatches clearEdits → persistableChanges becomes {}
    await waitFor(() => {
      const fileState = testStore.getState().files.files[DASHBOARD_ID];
      expect(Object.keys(fileState.persistableChanges ?? {})).toHaveLength(0);
    }, { timeout: 5000 });

    // Verify the save fetch was called with PATCH
    const saveCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url, init]) => typeof url === 'string' && url.includes(`/api/files/${DASHBOARD_ID}`) && init?.method?.toUpperCase() === 'PATCH'
    );
    expect(saveCalls).toHaveLength(1);
  });

  it('publishAll saves virtual question first then virtual dashboard with resolved references', async () => {
    const Q_VID = -1;
    const DASH_VID = -2;
    const REAL_Q_ID = 10;
    const REAL_DASH_ID = 11;
    const Q_NAME = 'Revenue Query';
    const DASH_NAME = 'New Dashboard';

    // Seed virtual files into Redux with negative IDs
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

    // Make the question dirty and link it to the dashboard
    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT revenue FROM sales', vizSettings: { type: 'table' as const }, database_name: 'default' },
    }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASH_VID, questionId: Q_VID }));

    // Track batch-create calls to assert save order
    const batchCreateBodies: Array<{ files: Array<{ virtualId: number; type: string; content: unknown }> }> = [];

    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';

      if (method === 'POST' && url.includes('/api/files/batch-create')) {
        const body = JSON.parse(init?.body as string) as typeof batchCreateBodies[number];
        batchCreateBodies.push(body);
        const callIndex = batchCreateBodies.length;

        if (callIndex === 1) {
          // First call: question (has no virtual-ID refs)
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{
                virtualId: Q_VID,
                file: {
                  id: REAL_Q_ID,
                  name: Q_NAME,
                  type: 'question',
                  path: `/org/${Q_NAME}`,
                  content: { query: 'SELECT revenue FROM sales', vizSettings: { type: 'table' }, database_name: 'default' },
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  references: [],
                  version: 1,
                  last_edit_id: null,
                  company_id: 1,
                },
              }],
            }),
          };
        }

        // Second call: dashboard (refs resolved to real question ID)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{
              virtualId: DASH_VID,
              file: {
                id: REAL_DASH_ID,
                name: DASH_NAME,
                type: 'dashboard',
                path: `/org/${DASH_NAME}`,
                content: { assets: [{ type: 'question', id: REAL_Q_ID }], layout: { columns: 12, items: [] } },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                references: [REAL_Q_ID],
                version: 1,
                last_edit_id: null,
                company_id: 1,
              },
            }],
          }),
        };
      }

      return { ok: true, status: 200, json: async () => ({ data: null }) };
    });

    await act(async () => {
      await publishAll();
    });

    // Two separate batch-create calls (one per topological level)
    expect(batchCreateBodies).toHaveLength(2);

    // First call: question only (no unresolved virtual refs)
    const firstFiles = batchCreateBodies[0].files;
    expect(firstFiles).toHaveLength(1);
    expect(firstFiles[0].virtualId).toBe(Q_VID);
    expect(firstFiles[0].type).toBe('question');

    // Second call: dashboard, and its assets already contain the REAL question ID
    const secondFiles = batchCreateBodies[1].files;
    expect(secondFiles).toHaveLength(1);
    expect(secondFiles[0].virtualId).toBe(DASH_VID);
    expect(secondFiles[0].type).toBe('dashboard');

    const savedDashContent = secondFiles[0].content as DashboardContent;
    expect(savedDashContent.assets?.some(a => (a as { id: number }).id === REAL_Q_ID)).toBe(true);

    // After publishAll, no dirty files remain
    const remaining = selectDirtyFiles(testStore.getState());
    expect(remaining).toHaveLength(0);
  });

  it('enters and exits edit mode via the Edit / Cancel toggle', async () => {
    const user = userEvent.setup();

    // Start in view mode for this test
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: false }));

    renderWithProviders(
      <>
        <FileHeader fileId={DASHBOARD_ID} fileType="dashboard" />
        <DashboardContainerV2 fileId={DASHBOARD_ID} />
      </>,
      { store: testStore }
    );

    // Dashboard region should be visible
    expect(await screen.findByRole('region', { name: 'Dashboard' })).toBeInTheDocument();

    // Click Edit
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBe(true);

    // Click Cancel — should exit edit mode and clear changes
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBe(false);
  });
});
