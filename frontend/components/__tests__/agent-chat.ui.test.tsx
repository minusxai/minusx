/**
 * Scenario 2: Agent-driven UI interactions
 *
 * Tests the full agent flow from Redux dispatch to UI reflection:
 *   dispatch(sendMessage)
 *   → Python backend + LLM mock (controlled tool call sequence)
 *   → CreateFile frontend tool executes (creates virtual question in Redux)
 *   → AgentFileResult component re-renders with the new question
 *
 * Infrastructure:
 * - withPythonBackend({ withLLMMock: true }) — real Python orchestrator + mock LLM
 * - setupTestDb — initializes test SQLite DB for conversation log storage
 * - setupMockFetch — routes /api/chat to Next.js handler; passes Python/LLM calls through
 * - storeModule.makeStore() — full Redux store (all reducers + chatListenerMiddleware)
 * - jest.spyOn(storeModule, 'getStore') — aligns tool-handlers.ts with the test store
 * - No Python query execution — the question is created without a database_name so
 *   CreateFile skips its auto-execute path
 *
 * Note: In JSDOM, `window` is defined, so chatListener sends POST /api/chat (relative URL).
 * setupMockFetch matches on startsWithUrl: ['/api/chat'] to handle these relative calls.
 */

// Must be hoisted before any module imports
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_agent_chat_ui.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
    DB_TYPE: 'sqlite',
  };
});

import React from 'react';
import { screen, waitFor } from '@testing-library/react';

import * as storeModule from '@/store/store';
import type { RootState } from '@/store/store';
import {
  createConversation,
  sendMessage,
  selectConversation,
} from '@/store/chatSlice';
import { useAppSelector } from '@/store/hooks';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as chatPostHandler } from '@/app/api/chat/route';

// ---------------------------------------------------------------------------
// Local display component — shows agent-created question files from Redux
// ---------------------------------------------------------------------------

function AgentFileResult() {
  const files = useAppSelector((state: RootState) => state.files.files);
  const questions = Object.values(files).filter(f => f.type === 'question');
  return (
    <div aria-label="agent file results">
      {questions.map(q => (
        <div
          key={q.id}
          role="article"
          aria-label={q.name || 'Untitled Question'}
        >
          {q.name || 'Untitled Question'}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Agent-driven UI — chat interactions', () => {
  // Real Python backend + LLM mock server (started once per describe block)
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({
    withLLMMock: true,
  });

  // Fresh test database per test (stores conversation logs)
  setupTestDb(getTestDbPath('agent_chat_ui'));

  // Route /api/chat to Next.js handler; let Python backend + LLM mock calls through
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
  });

  // Per-test store aligned with getStore() singleton used by tool-handlers.ts
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

  // --------------------------------------------------------------------------
  it('creates a question via the agent and the UI reflects the new file', async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();

    // Configure the LLM mock with a two-turn conversation:
    //   Turn 1 — agent calls CreateFile to create a virtual question
    //   Turn 2 — agent sends a final text message confirming completion
    await mockServer.configure([
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              id: 'tc_create_question',
              type: 'function',
              function: {
                name: 'CreateFile',
                // No database_name → CreateFile skips auto-execute, keeps test simple
                arguments: JSON.stringify({
                  file_type: 'question',
                  name: 'Total Revenue',
                }),
              },
            },
          ],
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

    // Render the file-result component backed by testStore
    renderWithProviders(<AgentFileResult />, { store: testStore });

    // Dispatch the agent conversation (simulates user typing and pressing Send)
    const CONV_ID = -200;
    testStore.dispatch(
      createConversation({
        conversationID: CONV_ID,
        agent: 'AnalystAgent',
        agent_args: { goal: 'Create a question called Total Revenue' },
      })
    );
    testStore.dispatch(
      sendMessage({
        conversationID: CONV_ID,
        message: 'Create a question called Total Revenue',
      })
    );

    // Wait for the agent to finish (conversation forks to a real positive ID)
    let realConvId = CONV_ID;
    await waitFor(
      () => {
        const temp = selectConversation(
          testStore.getState() as RootState,
          CONV_ID
        );
        if (temp?.forkedConversationID) {
          realConvId = temp.forkedConversationID;
        }
        const conv = selectConversation(
          testStore.getState() as RootState,
          realConvId
        );
        return conv?.executionState === 'FINISHED';
      },
      { timeout: 40000 }
    );

    // The conversation should have finished without errors
    const finalConv = selectConversation(
      testStore.getState() as RootState,
      realConvId
    );
    expect(finalConv?.executionState).toBe('FINISHED');
    expect(finalConv?.error).toBeUndefined();

    // The new question file should now exist in Redux state
    const filesState = testStore.getState().files.files;
    const createdQuestion = Object.values(filesState).find(
      f => f.type === 'question' && f.name === 'Total Revenue'
    );
    expect(createdQuestion).toBeDefined();

    // The rendered component should reflect the new question (Redux → UI binding)
    await screen.findByRole('article', { name: 'Total Revenue' }, { timeout: 5000 });

    // Verify the LLM mock was called (both turns consumed)
    const calls = await mockServer.getCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
  }, 45000);

  // --------------------------------------------------------------------------
  it('displays nothing before the agent runs and updates once it completes', async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();

    await mockServer.configure([
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              id: 'tc_create_q2',
              type: 'function',
              function: {
                name: 'CreateFile',
                arguments: JSON.stringify({
                  file_type: 'question',
                  name: 'Monthly Users',
                }),
              },
            },
          ],
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

    // Initially the list is empty — no articles yet
    expect(screen.queryByRole('article')).toBeNull();

    const CONV_ID = -300;
    testStore.dispatch(
      createConversation({
        conversationID: CONV_ID,
        agent: 'AnalystAgent',
        agent_args: { goal: 'Create a monthly users question' },
      })
    );
    testStore.dispatch(
      sendMessage({
        conversationID: CONV_ID,
        message: 'Create a question called Monthly Users',
      })
    );

    // Wait for the question to appear in the rendered list
    await screen.findByRole('article', { name: 'Monthly Users' }, { timeout: 40000 });
  }, 45000);
});
