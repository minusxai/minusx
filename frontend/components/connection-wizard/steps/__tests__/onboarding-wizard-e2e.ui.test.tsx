/**
 * Full setup-wizard e2e: fresh company → ConnectionWizard (questionnaire → context)
 * → onboarding agent runs to completion (real server orchestration + frontend
 * EditFile bridge) → docs written into the context file.
 *
 * - Fresh company: setupTestDb runs the real seed (workspace-template + migrations
 *   + atomicImport), which creates /org/context.
 * - CSV connection: seeded programmatically (the file-upload UI is file-IO and not
 *   exercised in jsdom — by design), so the wizard starts at the questionnaire step.
 * - Wizard: the REAL ConnectionWizard is rendered and driven through the
 *   questionnaire form and the context step via aria-label clicks.
 * - Agent: driven by the onboarding faux LLM through the REAL /api/chat orchestrator;
 *   the chat listener executes the pending frontend EditFile against the store and
 *   resumes until the conversation is FINISHED.
 *
 * Doubles as a regression guard: it asserts the agent RECEIVES an app_state that
 * contains the empty doc entry EditFile targets (fails if StepContext reverts to
 * sending the stale-closure app_state).
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// The agent's analytics queries are not exercised by this faux flow (it only emits
// EditFile); run-query is stubbed so an accidental real query can't hit a warehouse.
vi.mock('@/lib/connections/run-query', () => ({ runQuery: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })) }));

// useContext resolves the context-file id from the (real, seeded) store via
// selectContextFromPath, but it also drives an async loading state (useFile load +
// system-skills fetch). That loading flicker gates StepContext's auto-trigger and
// makes the run flaky, so we pin it to the resolved id — which IS the real seeded
// context file. (Its resolution logic is covered by the useContext unit tests.)
const { CONTEXT_HOLDER } = vi.hoisted(() => ({ CONTEXT_HOLDER: { id: 0 } }));
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ contextId: CONTEXT_HOLDER.id, contextLoading: false }),
}));
// ChatInterface is the display-only, readOnly agent-trace panel — not part of the
// wizard→agent→EditFile flow. The real one pulls in NavigationGuardProvider + the
// full chat UI (irrelevant here), so it stays stubbed.
vi.mock('@/components/explore/ChatInterface', () => {
  const React = require('react');
  return { __esModule: true, default: () => React.createElement('div', { 'aria-label': 'chat interface' }) };
});

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RootState } from '@/store/store';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { selectConversation, selectActiveConversation } from '@/store/chatSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { waitForConversationFinished } from '@/test/helpers/redux-wait';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { fauxRegistration as onboardingFaux } from '@/agents/onboarding/onboarding-agents';
import ConnectionWizard from '@/components/connection-wizard/ConnectionWizard';
import { NextRequest } from 'next/server';
import { POST as conversationsPostHandler, GET as conversationsListHandler } from '@/app/api/conversations/route';
import { GET as conversationGetHandler } from '@/app/api/conversations/[id]/route';
import { POST as conversationTurnsHandler } from '@/app/api/conversations/[id]/turns/route';
import { POST as filesBatchHandler } from '@/app/api/files/batch/route';
import { GET as connectionsGetHandler } from '@/app/api/connections/route';

const DOC_MARKDOWN = '# Sales Overview\\n\\nThis warehouse tracks revenue.';

describe('Onboarding wizard e2e — full wizard, agent runs to completion, writes docs', () => {
  setupTestDb(getTestDbPath('onboarding_wizard_e2e'));

  // Capture the app_state the agent actually receives on the v3 turn POST, then delegate to
  // the real orchestrator. This makes the e2e ALSO a bug guard: the captured app_state must
  // contain the empty doc entry EditFile targets.
  let capturedAgentAppState: any = null;

  // v3 conversations live in dedicated tables — the listener's IS_TEST path POSTs the turn then
  // polls GET /:id (no XHR/SSE in jsdom). A catch-all interceptor routes those param-bearing URLs
  // to the real in-process route handlers (the `interceptors` form rewrites the path to the
  // pattern, dropping the id, so it can't carry params).
  async function catchAllApiInterceptor(urlStr: string, init?: RequestInit): Promise<Response | null> {
    const BASE = 'http://localhost:3000';
    const method = (init?.method ?? 'GET').toUpperCase();
    const fullUrl = urlStr.startsWith('http') ? urlStr : `${BASE}${urlStr}`;
    const wrap = (res: Response, data: unknown) =>
      ({ ok: res.status < 400, status: res.status, json: async () => data } as Response);

    if (method === 'POST' && /\/api\/conversations\/\d+\/turns/.test(urlStr)) {
      const id = urlStr.match(/\/api\/conversations\/(\d+)\/turns/)![1];
      try {
        const body = init?.body ? JSON.parse(init.body as string) : null;
        if (capturedAgentAppState === null && body?.agentArgs?.app_state) {
          capturedAgentAppState = body.agentArgs.app_state;
        }
      } catch { /* ignore */ }
      const req = new NextRequest(fullUrl, { method: 'POST', body: init?.body as BodyInit, headers: init?.headers as HeadersInit });
      const res = await conversationTurnsHandler(req, { params: Promise.resolve({ id }) } as never);
      return wrap(res, await res.json());
    }
    if (method === 'GET' && /\/api\/conversations\/\d+(\?|$)/.test(urlStr)) {
      const id = urlStr.match(/\/api\/conversations\/(\d+)/)![1];
      const req = new NextRequest(fullUrl, { method: 'GET', headers: init?.headers as HeadersInit });
      const res = await conversationGetHandler(req, { params: Promise.resolve({ id }) } as never);
      return wrap(res, await res.json());
    }
    if (method === 'POST' && /\/api\/conversations(\?|$)/.test(urlStr)) {
      const req = new NextRequest(fullUrl, { method: 'POST', body: init?.body as BodyInit, headers: init?.headers as HeadersInit });
      const res = await conversationsPostHandler(req);
      return wrap(res, await res.json());
    }
    if (method === 'GET' && /\/api\/conversations(\?|$)/.test(urlStr)) {
      const req = new NextRequest(fullUrl, { method: 'GET', headers: init?.headers as HeadersInit });
      const res = await conversationsListHandler(req);
      return wrap(res, await res.json());
    }
    return null;
  }

  const mockFetch = setupMockFetch({
    additionalInterceptors: [catchAllApiInterceptor],
    interceptors: [
      { includesUrl: ['localhost:3000/api/files/batch'], startsWithUrl: ['/api/files/batch'], handler: filesBatchHandler },
      { includesUrl: ['localhost:3000/api/connections'], startsWithUrl: ['/api/connections'], handler: connectionsGetHandler },
    ],
  });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let contextId: number;

  beforeEach(async () => {
    capturedAgentAppState = null;
    fetchSpy = vi.spyOn(global as any, 'fetch').mockImplementation(mockFetch as any);
    testStore = storeModule.makeStore();
    getStoreSpy = vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    mockFetch.mockClear();

    const { DocumentDB } = await import('@/lib/database/documents-db');

    // Seed a CSV connection in the fresh company (file-upload UI not exercised in jsdom).
    await DocumentDB.create(
      'my_csv', '/org/connections/my_csv', 'connection',
      { id: 'my_csv', name: 'my_csv', type: 'csv', config: {} } as any, [], undefined, false,
    );

    // Resolve the seeded context file and seed it into the browser store directly.
    const ctx = await DocumentDB.getByPath('/org/context');
    contextId = ctx!.id;
    CONTEXT_HOLDER.id = contextId;
    testStore.dispatch(setFile({ file: ctx! }));
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    getStoreSpy.mockRestore();
  });

  it('drives questionnaire → context, runs the onboarding agent to completion, EditFile writes docs', async () => {
    // The agent writes docs into the empty docs array, then stops.
    onboardingFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('EditFile', {
          fileId: contextId,
          // File Architecture v2: the agent edits the file's MARKUP, not JSON. An empty
          // docs array projects to a self-closing `<docs/>`; populating it writes an
          // `<item>` whose markdown content is the element's text child.
          changes: [{
            oldMatch: '<docs/>',
            newMatch: `<docs><item><content>${DOC_MARKDOWN}</content></item></docs>`,
          }],
        }, { id: 'tc_editfile' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Documented the sales schema.', { stopReason: 'stop' }),
    ]);

    // Render the REAL wizard, resuming at the questionnaire step with the seeded conn.
    renderWithProviders(
      <ConnectionWizard initialStep="questionnaire" initialConnectionId={1} initialConnectionName="my_csv" />,
      { store: testStore },
    );

    // Step: questionnaire — fill the dataset description and continue.
    await userEvent.type(await screen.findByLabelText('What is this dataset about?'), 'Sales warehouse');
    await userEvent.click(await screen.findByLabelText('Continue to documentation step'));

    // Step: context (tables → docs). Advancing auto-triggers the onboarding agent.
    await userEvent.click(await screen.findByLabelText('Continue to documentation'));

    // The wizard creates a real v3 conversation via /api/conversations, then runs it.
    const convId = await waitFor(() => {
      const id = selectActiveConversation(testStore.getState() as RootState);
      expect(id).toBeTruthy();
      return id!;
    }, { timeout: 5000 });

    const realConvId = await waitForConversationFinished(() => testStore.getState() as RootState, convId);

    // The agent receives app_state with docs:[] (no empty doc appended).
    expect(capturedAgentAppState).not.toBeNull();
    const recvContent = capturedAgentAppState.state.fileState.content;
    expect(recvContent.versions[recvContent.versions.length - 1].docs).toEqual([]);

    // No orchestration/EditFile error.
    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    // The agent's EditFile wrote docs into the context file.
    const file = testStore.getState().files.files[contextId];
    const merged = { ...(file.content as any), ...(file.persistableChanges as any) };
    const docs = merged.versions[merged.versions.length - 1].docs;
    expect(docs.some((d: any) => typeof d.content === 'string' && d.content.includes('Sales Overview'))).toBe(true);

    // Bug-catching: no EditFile call should have failed during the run. If the
    // agent's oldMatch fails to match buildCurrentFileStr (serializer mismatch,
    // escape mismatch, key-order mismatch), it lands on errors[] as frontend-tool.
    const { DocumentDB } = await import('@/lib/database/documents-db');
    const convDoc = await DocumentDB.getById(realConvId);
    const convErrors = ((convDoc?.content as any)?.errors ?? []) as Array<{ source: string; message: string }>;
    const frontendErrors = convErrors.filter((e) => e.source === 'frontend-tool');
    expect(
      frontendErrors,
      `agent's EditFile produced ${frontendErrors.length} frontend-tool errors: ${frontendErrors.map(e => e.message).join(' | ')}`,
    ).toHaveLength(0);
  }, 45000);

  it('REALISTIC LLM faux: derives oldMatch from app_state the way a real model does — reveals serializer mismatch', async () => {
    // Mimic a real LLM (File Architecture v2): read the app_state from the user
    // prompt, copy a MARKUP fragment verbatim (`<docs/>`) from the file's `markup`
    // surface, and use that as oldMatch. If the markup the agent sees (`markup`
    // field) and the markup EditFile operates on (buildCurrentFileStr) serialize
    // differently, this fails — which is exactly the production symptom.
    onboardingFaux.setResponses([
      (ctx) => {
        // Find the rendered user prompt (it embeds the app_state, incl. `markup`).
        const userMsg = ctx.messages.find((m) => m.role === 'user');
        const text = typeof userMsg?.content === 'string'
          ? userMsg.content
          : ((userMsg?.content as Array<{ type?: string; text?: string }> | undefined) ?? [])
              .filter((c) => c?.type === 'text' && typeof c.text === 'string')
              .map((c) => c.text!)
              .join('');
        // Docs start empty — an empty array projects to a self-closing `<docs/>` in
        // the markup. A real LLM would copy that fragment from the prompt's markup.
        const emptyDocs = '<docs/>';
        if (!text.includes(emptyDocs)) {
          throw new Error(`prompt did not contain expected empty docs markup fragment "${emptyDocs}"`);
        }
        return fauxAssistantMessage(
          [fauxToolCall('EditFile', {
            fileId: contextId,
            changes: [{ oldMatch: emptyDocs, newMatch: `<docs><item><content>${DOC_MARKDOWN}</content></item></docs>` }],
          }, { id: 'tc_real_edit' })],
          { stopReason: 'toolUse' },
        );
      },
      fauxAssistantMessage('Documented.', { stopReason: 'stop' }),
    ]);

    renderWithProviders(
      <ConnectionWizard initialStep="questionnaire" initialConnectionId={1} initialConnectionName="my_csv" />,
      { store: testStore },
    );
    await userEvent.type(await screen.findByLabelText('What is this dataset about?'), 'Sales warehouse');
    await userEvent.click(await screen.findByLabelText('Continue to documentation step'));
    await userEvent.click(await screen.findByLabelText('Continue to documentation'));

    const convId = await waitFor(() => {
      const id = selectActiveConversation(testStore.getState() as RootState);
      expect(id).toBeTruthy();
      return id!;
    }, { timeout: 5000 });
    const realConvId = await waitForConversationFinished(() => testStore.getState() as RootState, convId);

    const { DocumentDB } = await import('@/lib/database/documents-db');
    const convDoc = await DocumentDB.getById(realConvId);
    const convErrors = ((convDoc?.content as any)?.errors ?? []) as Array<{ source: string; message: string }>;
    const frontendErrors = convErrors.filter((e) => e.source === 'frontend-tool');
    // Production bug surface: LLM-style oldMatch fails to match. If this fails,
    // the production symptom is reproduced — fix the serializer mismatch.
    expect(
      frontendErrors,
      `LLM-style EditFile failed: ${frontendErrors.map(e => e.message).join(' | ')}`,
    ).toHaveLength(0);
  }, 45000);

  it('post-edit guard rejects changes to non-doc fields on context files', async () => {
    // The post-edit guard for context files (`tool-handlers.ts`) rejects any
    // change outside `docs[]` within versions (e.g. databases, published, etc.).
    // Use a two-step faux: first EditFile writes a doc (succeeds, so the agent
    // is in the context-file flow), then a second EditFile touches `published`
    // which the guard should reject.
    onboardingFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('EditFile', {
          fileId: contextId,
          // File Architecture v2 markup edits: write a doc (the allowed field) AND
          // flip the non-doc `published.all` (1 → 0). The guard strips docs before
          // comparing, so the published change is detected and the edit is rejected.
          // Context is a schemaless type, so the numeric `published.all` projects to
          // an annotated `<all type="number">` element (not a bare `<all>`).
          changes: [
            { oldMatch: '<docs/>', newMatch: '<docs><item><content># Doc</content></item></docs>' },
            { oldMatch: '<all type="number">1</all>', newMatch: '<all type="number">0</all>' },
          ],
        }, { id: 'tc_nonDoc' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    renderWithProviders(
      <ConnectionWizard initialStep="questionnaire" initialConnectionId={1} initialConnectionName="my_csv" />,
      { store: testStore },
    );
    await userEvent.type(await screen.findByLabelText('What is this dataset about?'), 'Sales warehouse');
    await userEvent.click(await screen.findByLabelText('Continue to documentation step'));
    await userEvent.click(await screen.findByLabelText('Continue to documentation'));

    const convId = await waitFor(() => {
      const id = selectActiveConversation(testStore.getState() as RootState);
      expect(id).toBeTruthy();
      return id!;
    }, { timeout: 5000 });
    const realConvId = await waitForConversationFinished(() => testStore.getState() as RootState, convId);

    // v3: errors live in the conversation error stream (kind='error' rows in messages, mirrored from frontend-tool results).
    const { loadErrors } = await import('@/lib/data/conversations.server');
    const convErrors = await loadErrors(realConvId);

    // The guard rejection is logged as a frontend-tool error.
    const guardErrors = convErrors.filter((e) =>
      /can only modify docs within versions/i.test(e.message),
    );
    expect(guardErrors.length).toBeGreaterThan(0);
    expect(guardErrors[0].source).toBe('frontend-tool');
  }, 45000);
});
