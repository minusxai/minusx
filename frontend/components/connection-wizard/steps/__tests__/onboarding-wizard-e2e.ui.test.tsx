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
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { POST as chatInitHandler } from '@/app/api/chat/init/route';
import { POST as filesBatchHandler } from '@/app/api/files/batch/route';
import { GET as connectionsGetHandler } from '@/app/api/connections/route';

const DOC_MARKDOWN = '# Sales Overview\\n\\nThis warehouse tracks revenue.';

describe('Onboarding wizard e2e — full wizard, agent runs to completion, writes docs', () => {
  setupTestDb(getTestDbPath('onboarding_wizard_e2e'));

  // Capture the app_state the agent actually receives on the first /api/chat call,
  // then delegate to the real orchestrator. This makes the e2e ALSO a bug guard:
  // the captured app_state must contain the empty doc entry EditFile targets.
  let capturedAgentAppState: any = null;
  async function capturingChatHandler(req: any) {
    try {
      const body = await req.clone().json();
      if (capturedAgentAppState === null && body?.agent_args?.app_state) {
        capturedAgentAppState = body.agent_args.app_state;
      }
    } catch { /* ignore */ }
    return chatPostHandler(req);
  }

  const mockFetch = setupMockFetch({
    interceptors: [
      { includesUrl: ['localhost:3000/api/chat/init'], startsWithUrl: ['/api/chat/init'], handler: chatInitHandler },
      { includesUrl: ['localhost:3000/api/chat'], startsWithUrl: ['/api/chat'], handler: capturingChatHandler },
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
    // The agent fills the empty doc entry the wizard appended, then stops.
    onboardingFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('EditFile', {
          fileId: contextId,
          changes: [{ oldMatch: '"content":""', newMatch: `"content":"${DOC_MARKDOWN}"` }],
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

    // Step: context (tables → docs). Advancing appends the empty doc entry and
    // auto-triggers the onboarding agent.
    await userEvent.click(await screen.findByLabelText('Continue to documentation'));

    // The wizard creates a real conversation via /api/chat/init, then runs it.
    const convId = await waitFor(() => {
      const id = selectActiveConversation(testStore.getState() as RootState);
      expect(id).toBeTruthy();
      return id!;
    }, { timeout: 5000 });

    const realConvId = await waitForConversationFinished(() => testStore.getState() as RootState, convId);

    // Bug guard: the agent must have RECEIVED an app_state containing the empty doc
    // entry (not docs:[]). Fails if StepContext sends the stale-closure app_state.
    expect(capturedAgentAppState).not.toBeNull();
    const recvContent = capturedAgentAppState.state.fileState.content;
    expect(recvContent.versions[recvContent.versions.length - 1].docs).toEqual([{ content: '' }]);

    // No orchestration/EditFile error.
    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    // The empty doc entry now carries the agent's markdown — EditFile matched and applied.
    const file = testStore.getState().files.files[contextId];
    const merged = { ...(file.content as any), ...(file.persistableChanges as any) };
    const docs = merged.versions[merged.versions.length - 1].docs;
    expect(docs.some((d: any) => typeof d.content === 'string' && d.content.includes('Sales Overview'))).toBe(true);
  }, 45000);
});
