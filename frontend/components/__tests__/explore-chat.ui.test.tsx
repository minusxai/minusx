/**
 * Explore page E2E UI test — submit question → agent responds → see answer → toggle thinking.
 *
 * Verifies:
 * - New conversation triggers router.push('/explore/{realId}')
 * - Final TalkToUser answer is visible in the DOM
 * - "Show Thinking" button appears and toggles thinking content visibility
 *
 * Infrastructure: same as agent-creates-files.ui.test.tsx
 * - withPythonBackend({ withLLMMock: true }) — real Python orchestrator + mock LLM
 * - setupTestDb — initialises SQLite DB for conversation log storage
 * - setupMockFetch — routes /api/chat to Next.js handler; passes Python/LLM calls through
 * - storeModule.makeStore() — full Redux store (all reducers + chatListenerMiddleware)
 * - jest.spyOn(storeModule, 'getStore') — aligns tool-handlers.ts with the test store
 *
 * In JSDOM, `window` is defined, so chatListener posts to /api/chat (relative URL).
 * setupMockFetch matches on startsWithUrl: ['/api/chat'] to intercept these.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must appear before any import statements
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_explore_chat_ui.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
    DB_TYPE: 'sqlite',
  };
});

// Mock router — ChatInterface calls router.push('/explore/{id}') on new conversation
const mockRouterPush = jest.fn();
jest.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock NavigationGuardProvider — ChatInterface calls useNavigationGuard() which throws
// if rendered outside the provider
// attachment-extract uses import.meta.url (ESM-only), which Jest/CommonJS can't parse
jest.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: jest.fn().mockResolvedValue(''),
  SUPPORTED_DOC_EXTENSIONS: [],
}));

// react-markdown (pulled in by Markdown.tsx → ContentDisplay → SimpleChatMessage → ChatInterface)
// is ESM-only. Stub it so children render as plain text — assertions on text content still work.
jest.mock('@/components/Markdown', () => {
  const React = require('react');
  const MarkdownMock = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', { 'data-testid': 'markdown' }, children);
  return {
    __esModule: true,
    default: MarkdownMock,
  };
});

jest.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({
    navigate: jest.fn(),
    isBlocked: false,
    confirmNavigation: jest.fn(),
    cancelNavigation: jest.fn(),
  }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as storeModule from '@/store/store';
import type { RootState } from '@/store/store';
import {
  createConversation,
  sendMessage,
  selectConversation,
  generateVirtualConversationId,
} from '@/store/chatSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { waitForConversationFinished } from '@/test/helpers/redux-wait';

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as chatPostHandler } from '@/app/api/chat/route';

import ChatInterface from '@/components/explore/ChatInterface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Catch-all for any /api/* calls that aren't explicitly intercepted (e.g. /api/connections
 * triggered by useContext → useConnections inside ChatInterface). Returns empty success
 * response so the component renders without blocking.
 */
async function catchAllApiInterceptor(
  urlStr: string,
  _init?: RequestInit
): Promise<Response | null> {
  const isApi =
    urlStr.startsWith('/api/') || urlStr.includes('localhost:3000/api/');
  const isChat = urlStr.includes('/api/chat');
  if (isApi && !isChat) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: null, success: true }),
      text: async () => '',
    } as Response;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Explore page: submit question → agent responds → see answer → toggle thinking', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({
    withLLMMock: true,
  });

  // SQLite DB for conversation log persistence
  setupTestDb(getTestDbPath('explore_chat_ui'));

  // Route /api/chat to the real Next.js handler; let Python + LLM calls through
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
    additionalInterceptors: [catchAllApiInterceptor],
  });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    mockFetch.mockClear();
    mockRouterPush.mockClear();
    // JSDOM doesn't implement scrollTo on elements — polyfill to prevent throws in ChatInterface
    window.HTMLElement.prototype.scrollTo = jest.fn();
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
  });

  it(
    'shows the final answer and supports toggling thinking after the agent responds',
    async () => {
      const mockServer = getLLMMockServer!();
      await mockServer.reset();

      // Configure LLM mock: one TalkToUser call with <thinking> + <answer>, then done
      await mockServer.configure([
        {
          // Turn 1: agent responds via TalkToUser with thinking and answer blocks
          response: {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                id: 'tc_talk_to_user',
                type: 'function',
                function: {
                  name: 'TalkToUser',
                  arguments: JSON.stringify({
                    content:
                      '<thinking>Let me think through this step by step. The user is asking about the data.</thinking>' +
                      '<answer>Based on the data, the answer is 42.</answer>',
                  }),
                },
              },
            ],
            finish_reason: 'tool_calls',
          },
          usage: { total_tokens: 120, prompt_tokens: 90, completion_tokens: 30 },
        },
        {
          // Turn 2: final text response — ends the agent loop
          response: {
            content: 'Done.',
            role: 'assistant',
            tool_calls: [],
            finish_reason: 'stop',
          },
          usage: { total_tokens: 60, prompt_tokens: 45, completion_tokens: 15 },
        },
      ]);

      // Render ChatInterface mimicking /explore (no conversationId = new conversation)
      renderWithProviders(
        <ChatInterface
          conversationId={undefined}
          contextPath="/org"
          container="page"
        />,
        { store: testStore }
      );

      // Dispatch new conversation + initial message (same pattern as agent-creates-files tests)
      const CONV_ID = generateVirtualConversationId();
      testStore.dispatch(
        createConversation({
          conversationID: CONV_ID,
          agent: 'AnalystAgent',
          agent_args: {
            connection_id: null,
            context_path: '/org',
            context_version: null,
            schema: [],
            context: '',
          },
          message: 'What is the answer to everything?',
        })
      );

      // Wait for conversation to finish (follows fork chain: virtual ID → real file ID)
      const realConvId = await waitForConversationFinished(
        () => testStore.getState() as RootState,
        CONV_ID
      );

      // -----------------------------------------------------------------------
      // Assertions
      // -----------------------------------------------------------------------

      // No errors in conversation
      expect(
        selectConversation(testStore.getState() as RootState, realConvId)?.error
      ).toBeUndefined();

      // ChatInterface calls router.push('/explore/{realId}') once the real ID arrives
      // Navigation is triggered by a useEffect — wrap in waitFor to allow React to re-render
      await waitFor(
        () => expect(mockRouterPush).toHaveBeenCalledWith(
          expect.stringMatching(/^\/explore\/\d+$/)
        )
      );

      // Final answer from <answer> block is visible in the DOM
      const answerBlock = await screen.findByLabelText('Answer block');
      expect(answerBlock).toHaveTextContent(/the answer is 42/i);

      // "Show Thinking" button is present; thinking block is hidden by default
      const showThinkingBtn = screen.getByLabelText('Show Thinking');
      expect(screen.queryByLabelText('Thinking block')).not.toBeInTheDocument();

      // Clicking "Show Thinking" reveals thinking content and flips the button label
      await userEvent.click(showThinkingBtn);
      const thinkingBlock = await screen.findByLabelText('Thinking block');
      expect(thinkingBlock).toHaveTextContent(/let me think through this step by step/i);
      expect(screen.getByLabelText('Hide Thinking')).toBeInTheDocument();
    },
    45000
  );
});
