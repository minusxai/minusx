/**
 * Agent creates files — smoke tests for the agent → Redux → UI binding.
 *
 * These tests verify the end-to-end path:
 *   dispatch(sendMessage)
 *   → Python backend + LLM mock (controlled tool call sequence)
 *   → CreateFile frontend tool executes (creates virtual file in Redux)
 *   → Component re-renders with the new file
 *
 * These tests have no direct manual equivalent — they specifically exercise
 * the agent infrastructure (LLM mock → Python → Next.js chat handler →
 * Redux listener middleware → frontend tool execution).
 *
 * Infrastructure:
 * - withPythonBackend({ withLLMMock: true }) — real Python orchestrator + mock LLM
 * - setupTestDb — initializes test SQLite DB for conversation log storage
 * - setupMockFetch — routes /api/chat to Next.js handler; passes Python/LLM calls through
 * - storeModule.makeStore() — full Redux store (all reducers + chatListenerMiddleware)
 * - jest.spyOn(storeModule, 'getStore') — aligns tool-handlers.ts with the test store
 * - No Python query execution — questions are created without a connection_name so
 *   CreateFile skips its auto-execute path
 *
 * Note: In JSDOM, `window` is defined, so chatListener sends POST /api/chat (relative URL).
 * setupMockFetch matches on startsWithUrl: ['/api/chat'] to handle these relative calls.
 */

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_agent_creates_files_ui.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
    DB_TYPE: 'sqlite',
  };
});

import React from 'react';
import { screen, waitFor } from '@testing-library/react';

import * as storeModule from '@/store/store';
import type { RootState } from '@/store/store';
import { createConversation, sendMessage, selectConversation } from '@/store/chatSlice';
import { useAppSelector } from '@/store/hooks';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { waitForConversationFinished } from '@/test/helpers/redux-wait';

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as chatPostHandler } from '@/app/api/chat/route';

// ---------------------------------------------------------------------------
// Local display component — renders agent-created question files from Redux
// ---------------------------------------------------------------------------

function AgentFileResult() {
  const files = useAppSelector((state: RootState) => state.files.files);
  const questions = Object.values(files).filter(f => f.type === 'question');
  return (
    <div aria-label="agent file results">
      {questions.map(q => {
        // metadataChanges.name wins over file.name (name is set via setMetadataEdit)
        const effectiveName = q.metadataChanges?.name ?? q.name ?? 'Untitled Question';
        return (
          <div key={q.id} role="article" aria-label={effectiveName}>
            {effectiveName}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared agent infrastructure (Python backend + LLM mock + fetch routing)
// ---------------------------------------------------------------------------

/** Mock template response for createVirtualFile() → POST /api/files/template */
async function templateInterceptor(urlStr: string, init?: RequestInit): Promise<Response | null> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  if (method === 'POST' && urlStr.includes('/api/files/template')) {
    const body = JSON.parse(init?.body as string) as { type: string };
    const content = body.type === 'question'
      ? { query: '', vizSettings: { type: 'table' }, connection_name: '', parameters: [] }
      : { assets: [], layout: { columns: 12, items: [] } };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { content, fileName: '', metadata: { availableDatabases: [] } } }),
    } as Response;
  }
  return null;
}

// ============================================================================
// Agent creates files via chat
// ============================================================================

describe('Agent creates files via chat', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });

  setupTestDb(getTestDbPath('agent_creates_files_ui'));

  const mockFetch = setupMockFetch({
    getPythonPort,
    getLLMMockPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler,
      },
    ],
    additionalInterceptors: [templateInterceptor],
  });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    mockFetch.mockClear();
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
  });

  it('creates a question via the agent and the UI reflects the new file', async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();

    await mockServer.configure([
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_create_question',
            type: 'function',
            function: {
              name: 'CreateFile',
              arguments: JSON.stringify({ file_type: 'question', name: 'Total Revenue' }),
            },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 120, prompt_tokens: 90, completion_tokens: 30 },
      },
      {
        response: {
          content: "Done! I've created the Total Revenue question.",
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop',
        },
        usage: { total_tokens: 80, prompt_tokens: 60, completion_tokens: 20 },
      },
    ]);

    renderWithProviders(<AgentFileResult />, { store: testStore });

    const CONV_ID = -200;
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: 'Create a question called Total Revenue' },
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: 'Create a question called Total Revenue',
    }));

    const realConvId = await waitForConversationFinished(
      () => testStore.getState() as RootState,
      CONV_ID
    );

    // Conversation finished without errors
    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    // Question exists in Redux (name lives in metadataChanges.name after setMetadataEdit)
    const filesState = testStore.getState().files.files;
    const createdQuestion = Object.values(filesState).find(
      f => f.type === 'question' && (f.metadataChanges?.name ?? f.name) === 'Total Revenue'
    );
    expect(createdQuestion).toBeDefined();

    // Component reflects the new question
    await screen.findByLabelText('Total Revenue');

    // Both LLM turns were consumed
    expect((await mockServer.getCalls()).length).toBeGreaterThanOrEqual(2);
  }, 45000);

  it('displays nothing before the agent runs and updates once it completes', async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();

    await mockServer.configure([
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_create_q2',
            type: 'function',
            function: {
              name: 'CreateFile',
              arguments: JSON.stringify({ file_type: 'question', name: 'Monthly Users' }),
            },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 100, prompt_tokens: 75, completion_tokens: 25 },
      },
      {
        response: {
          content: 'Done! Monthly Users question created.',
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop',
        },
        usage: { total_tokens: 70, prompt_tokens: 55, completion_tokens: 15 },
      },
    ]);

    renderWithProviders(<AgentFileResult />, { store: testStore });

    // Nothing rendered before the agent runs
    expect(screen.queryByLabelText('Monthly Users')).toBeNull();

    const CONV_ID = -300;
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: 'Create a monthly users question' },
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: 'Create a question called Monthly Users',
    }));

    // Once the agent finishes, the article appears
    await screen.findByLabelText('Monthly Users', {}, { timeout: 40000 });
  }, 45000);
});
