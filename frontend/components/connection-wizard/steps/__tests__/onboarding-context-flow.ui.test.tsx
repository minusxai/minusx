/**
 * Onboarding setup-wizard flow (StepContext) — verifies the OnboardingContextAgent
 * receives correct app_state when auto-triggered from the docs sub-step.
 *
 * The agent uses EditFile to add/modify docs in the context file directly —
 * no pre-appended empty doc slot needed.
 */

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const { CONTEXT_ID } = vi.hoisted(() => ({ CONTEXT_ID: 9001 }));

// useContext resolves the context file id for the current home path.
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ contextId: CONTEXT_ID, contextLoading: false }),
}));

// The file is seeded directly into the store; no-op the network load that useFile
// fires (keep editFile / buildCurrentFileStr real).
vi.mock('@/lib/api/file-state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/file-state')>('@/lib/api/file-state');
  return { ...actual, loadFiles: vi.fn(async () => []) };
});

// ChatInterface is heavy and only renders after the agent triggers — stub it.
vi.mock('@/components/explore/ChatInterface', () => {
  const React = require('react');
  return { __esModule: true, default: () => React.createElement('div', { 'aria-label': 'chat interface' }) };
});

// ─── Imports ──────────────────────────────────────────────────────────────────
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { setUser } from '@/store/authSlice';
import { setFile } from '@/store/filesSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StepContext from '@/components/connection-wizard/steps/StepContext';
import type { DbFile, ContextContent } from '@/lib/types';

// v3: in IS_TEST mode the chat listener POSTs the turn (with agentArgs.app_state) to
// /api/conversations/:id/turns via fetch (not the XHR stream path) — capture that body.
let capturedChatBody: any = null;

// ─── Fixtures ───────────────────────────────────────────────────────────────────
const now = '2026-01-01T00:00:00Z';

function contextContent(): ContextContent {
  return {
    fullDocs: [],
    fullSchema: [],
    fullSkills: [],
    parentSchema: [],
    published: { all: 1 },
    versions: [
      { createdAt: now, createdBy: 1, description: 'Default context', docs: [], version: 1, whitelist: '*' },
    ],
  } as unknown as ContextContent;
}

function contextDbFile(): DbFile {
  return {
    id: CONTEXT_ID,
    name: 'Knowledge Base',
    path: '/org/context',
    type: 'context',
    references: [],
    version: 1,
    last_edit_id: null,
    created_at: now,
    updated_at: now,
    content: contextContent(),
  } as unknown as DbFile;
}

const CSV_CONNECTION = {
  metadata: { name: 'my_csv', type: 'csv' as const, config: {}, created_at: now, updated_at: now },
  schema: {
    schemas: [
      { schema: 'data', tables: [{ table: 'sales', columns: [{ name: 'amount', type: 'number' }] }] },
    ],
  },
} as any;

describe('Onboarding wizard — context agent app_state', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    capturedChatBody = null;

    store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    store.dispatch(setUser({
      userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org',
    } as any));
    store.dispatch(setFile({ file: contextDbFile() }));

    global.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      // v3: turn POST carries agentArgs.app_state — capture it.
      if (/\/api\/conversations\/\d+\/turns/.test(u)) {
        capturedChatBody = init?.body ? JSON.parse(init.body) : null;
        return { ok: true, status: 200, json: async () => ({ runStatus: 'idle', pendingToolCalls: [], finalSeq: 1 }) } as Response;
      }
      // v3: poll GET /:id — return a settled conversation so the listener's poll loop exits.
      if (/\/api\/conversations\/\d+(\?|$)/.test(u)) {
        return {
          ok: true, status: 200,
          json: async () => ({ conversation: { id: 5000, runStatus: 'idle', version: 3 }, messages: [], errors: [] }),
        } as Response;
      }
      // v3: create conversation.
      if (/\/api\/conversations(\?|$)/.test(u)) {
        return { ok: true, status: 200, json: async () => ({ id: 5000 }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends app_state with the current docs to the agent', async () => {
    renderWithProviders(
      <StepContext
        connectionName="my_csv"
        connectionId={42}
        onComplete={() => {}}
        staticSchemas={['data']}
        questionnaireAnswers={{ datasetDescription: 'sales data', keyMetrics: 'revenue', dashboardPreference: 'overview' }}
        connections={{ my_csv: CSV_CONNECTION }}
      />,
      { store },
    );

    // Advance tables → docs. This auto-triggers the onboarding agent.
    await userEvent.click(await screen.findByLabelText('Continue to documentation'));

    await waitFor(() => expect(capturedChatBody).not.toBeNull(), { timeout: 5000 });

    // The agent sees the FLAT view (shapeContextForAgent) of the live version — docs at the top
    // level, no version wrapper.
    const sentContent = capturedChatBody.agentArgs.app_state.state.fileState.content;

    // The agent sees the file's current docs (empty array — no pre-appended slot).
    // It will use EditFile to add docs directly.
    expect(sentContent.docs).toEqual([]);
  });
});
