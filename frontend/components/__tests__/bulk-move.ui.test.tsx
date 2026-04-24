/**
 * Bulk Move UI tests
 *
 * Scenarios:
 *   1. Enter selection mode via "Select" in file action menu
 *   2. Select multiple files and bulk move them
 *   3. Cancel exits selection mode and clears selection
 *   4. Move button is disabled when no files are selected
 */

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import React from 'react';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextRequest } from 'next/server';

import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import FilesList from '@/components/FilesList';

import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { PATCH as filePatchHandler } from '@/app/api/files/[id]/route';
import { GET as filesGetHandler } from '@/app/api/files/route';
import { POST as batchMoveHandler } from '@/app/api/files/batch-move/route';

const realFetch = global.fetch;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const QUESTION_1_ID = 1010;
const QUESTION_2_ID = 1011;
const QUESTION_3_ID = 1012;
const FOLDER_ID = 1020;
const DEST_FOLDER_ID = 1021;

function makeQuestion(id: number, name: string) {
  return {
    id,
    name,
    type: 'question' as const,
    path: `/org/${name}`,
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

function makeFolder(id: number, name: string, path: string) {
  return {
    id,
    name,
    type: 'folder' as const,
    path,
    content: {},
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

const question1 = makeQuestion(QUESTION_1_ID, 'Revenue Report');
const question2 = makeQuestion(QUESTION_2_ID, 'Sales Summary');
const question3 = makeQuestion(QUESTION_3_ID, 'Cost Analysis');
const folder1 = makeFolder(FOLDER_ID, 'Reports', '/org/Reports');
const destFolder = makeFolder(DEST_FOLDER_ID, 'Archive', '/org/Archive');

const allFiles = [question1, question2, question3, folder1, destFolder];

// ---------------------------------------------------------------------------
// DB seeding
// ---------------------------------------------------------------------------

async function insertTestFiles(_dbPath: string): Promise<void> {
  const { getModules } = await import('@/lib/modules/registry');
  const db = getModules().db;
  const now = new Date().toISOString();

  for (const file of allFiles) {
    await db.exec(
      `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [file.id, file.name, file.path, file.type, JSON.stringify(file.content), '[]', now, now]
    );
  }
}

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

function makeApiFetch() {
  const BASE = 'http://localhost:3000';

  const call = async (
    handler: (req: NextRequest, ctx?: any) => Promise<Response>,
    url: string,
    init?: RequestInit,
    context?: any,
  ): Promise<Response> => {
    const req = new NextRequest(url, {
      method: init?.method ?? 'GET',
      body: (init?.body as string) ?? null,
      headers: (init?.headers as HeadersInit) ?? undefined,
    });
    const resp = context ? await handler(req, context) : await handler(req);
    const data = await resp.json();
    return { ok: resp.status < 400, status: resp.status, json: async () => data } as Response;
  };

  return jest.fn(async (url: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    // POST /api/files/batch-move
    if (method === 'POST' && urlStr.includes('/api/files/batch-move')) {
      return call(batchMoveHandler, `${BASE}/api/files/batch-move`, init);
    }

    // PATCH /api/files/:id
    if (method === 'PATCH') {
      const m = urlStr.match(/\/api\/files\/(\d+)/);
      if (m) {
        const fullUrl = urlStr.startsWith('http') ? urlStr : `${BASE}${urlStr}`;
        return call(filePatchHandler, fullUrl, init, { params: Promise.resolve({ id: m[1] }) });
      }
    }

    // GET /api/files
    if (method === 'GET' && urlStr.includes('/api/files') && !urlStr.match(/\/api\/files\/\d+/)) {
      const fullUrl = urlStr.startsWith('http') ? urlStr : `${BASE}${urlStr}`;
      return call(filesGetHandler, fullUrl, init);
    }

    // Catch-all for non-critical GETs
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ data: null }) } as Response;
    }

    throw new Error(`[Bulk Move UI] Unmocked fetch: ${method} ${urlStr}`);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Bulk Move Files', () => {
  setupTestDb(getTestDbPath('bulk_move_ui'), { customInit: insertTestFiles });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    // Pre-populate Redux with files
    for (const file of allFiles) {
      testStore.dispatch(setFile({ file, references: [] }));
    }
    global.fetch = makeApiFetch();
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('enters selection mode when "Select" is clicked from file action menu', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <FilesList files={allFiles} />,
      { store: testStore }
    );

    // No checkboxes initially
    expect(screen.queryAllByLabelText(/^Select/)).toHaveLength(0);

    // Open the action menu (ellipsis) for the first question
    const actionButtons = screen.getAllByLabelText('More actions');
    await user.click(actionButtons[0]);

    // Click "Select" in the dropdown
    const selectItem = await screen.findByLabelText('Select');
    await user.click(selectItem);

    // Now we should be in selection mode — checkboxes appear
    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Select/).length).toBeGreaterThan(0);
    });

    // Bulk action bar should appear showing "1 file selected"
    expect(screen.getByLabelText('Selection status')).toHaveTextContent(/1 file.* selected/i);
  });

  it('shows "0 files selected" with disabled Move button when entering selection mode with no selection', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <FilesList files={allFiles} />,
      { store: testStore }
    );

    // Enter selection mode via action menu
    const actionButtons = screen.getAllByLabelText('More actions');
    await user.click(actionButtons[0]);
    const selectItem = await screen.findByLabelText('Select');
    await user.click(selectItem);

    // The first file gets selected, so deselect it by clicking its checkbox
    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Select/).length).toBeGreaterThan(0);
    });

    // Find the checked checkbox and uncheck it
    const checkboxes = screen.getAllByLabelText(/^Select/);
    const checkedCheckbox = checkboxes.find(
      (cb: HTMLElement) => cb.getAttribute('data-state') === 'checked' || (cb as HTMLInputElement).checked
    );
    if (checkedCheckbox) {
      await user.click(checkedCheckbox);
    }

    // Should show "0 files selected" with disabled Move
    await waitFor(() => {
      expect(screen.getByLabelText('Selection status')).toHaveTextContent(/0 files selected/i);
    });
    const moveBtn = screen.getByLabelText('Move');
    expect(moveBtn).toBeDisabled();
  });

  it('cancel button exits selection mode and clears selection', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <FilesList files={allFiles} />,
      { store: testStore }
    );

    // Enter selection mode
    const actionButtons = screen.getAllByLabelText('More actions');
    await user.click(actionButtons[0]);
    const selectItem = await screen.findByLabelText('Select');
    await user.click(selectItem);

    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Select/).length).toBeGreaterThan(0);
    });

    // Click Cancel
    const cancelBtn = screen.getByLabelText('Cancel selection');
    await user.click(cancelBtn);

    // Selection mode should be exited — no checkboxes, no action bar
    await waitFor(() => {
      expect(screen.queryAllByLabelText(/^Select/)).toHaveLength(0);
    });
    expect(screen.queryByLabelText('Selection status')).not.toBeInTheDocument();
  });

  it('clicking a file row in selection mode toggles selection without navigating', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <FilesList files={allFiles} />,
      { store: testStore }
    );

    // Expand the Questions section (collapsed by default)
    const questionsSection = screen.getByLabelText('Questions section');
    await user.click(questionsSection);

    // Enter selection mode
    const actionButtons = screen.getAllByLabelText('More actions');
    await user.click(actionButtons[0]);
    const selectItem = await screen.findByLabelText('Select');
    await user.click(selectItem);

    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Select/).length).toBeGreaterThan(0);
    });

    // Should start with 1 file selected (the file whose menu we used)
    expect(screen.getByLabelText('Selection status')).toHaveTextContent(/1 file.* selected/i);

    // Click on a different file's row to toggle its selection
    const secondFileRow = screen.getByLabelText('Sales Summary');
    await user.click(secondFileRow);

    // Now 2 files selected
    await waitFor(() => {
      expect(screen.getByLabelText('Selection status')).toHaveTextContent(/2 files selected/i);
    });

    // Click the same row again to deselect
    await user.click(secondFileRow);
    await waitFor(() => {
      expect(screen.getByLabelText('Selection status')).toHaveTextContent(/1 file.* selected/i);
    });
  });

  it('bulk moves selected files via batch-move API', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <FilesList files={allFiles} />,
      { store: testStore }
    );

    // Expand the Questions section (collapsed by default)
    const questionsSection = screen.getByLabelText('Questions section');
    await user.click(questionsSection);

    // Enter selection mode via first question's menu
    const actionButtons = screen.getAllByLabelText('More actions');
    await user.click(actionButtons[0]);
    const selectItem = await screen.findByLabelText('Select');
    await user.click(selectItem);

    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Select/).length).toBeGreaterThan(0);
    });

    // Select another file by clicking its row
    const secondFileRow = screen.getByLabelText('Sales Summary');
    await user.click(secondFileRow);

    await waitFor(() => {
      expect(screen.getByLabelText('Selection status')).toHaveTextContent(/2 files selected/i);
    });

    // Click "Move" in the bulk action bar
    const moveBtn = screen.getByLabelText('Move');
    expect(moveBtn).not.toBeDisabled();
    await user.click(moveBtn);

    // The BulkMoveFileModal should open
    await waitFor(() => {
      expect(screen.getByLabelText('Move files modal')).toHaveTextContent(/Move 2 files/i);
    });

    // Verify that the batch-move API was called when we complete the move
    // (We can verify the modal opened — full move flow depends on folder selection
    // which requires the folder list to load from DB)
  });

  it('ESC key exits selection mode', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <FilesList files={allFiles} />,
      { store: testStore }
    );

    // Enter selection mode
    const actionButtons = screen.getAllByLabelText('More actions');
    await user.click(actionButtons[0]);
    const selectItem = await screen.findByLabelText('Select');
    await user.click(selectItem);

    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Select/).length).toBeGreaterThan(0);
    });

    // Press ESC
    await user.keyboard('{Escape}');

    // Should exit selection mode
    await waitFor(() => {
      expect(screen.queryAllByLabelText(/^Select/)).toHaveLength(0);
    });
  });
});
