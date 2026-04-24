/**
 * Chat API E2E Tests
 *
 * Combined test file covering:
 *   1. Chat API Handler Tests — tests the /api/chat route handler directly
 *   2. Chat E2E Redux Orchestration — tests the full Redux → Listener → API → Python stack
 *   3. Agent E2E with Dynamic LLM Mocking (merged from chatAnalystDynamic.test.ts)
 *   4. Chat Interruption & Error Recovery E2E (merged from chatInterruptionE2E.test.ts)
 *   5. Chat Queue E2E (merged from chatQueueE2E.test.ts)
 *   6. Edit and Fork E2E (merged from editAndFork.test.ts)
 */

import {
  createConversation,
  sendMessage,
  selectConversation,
  completeToolCall,
  updateConversation,
  queueMessage,
  clearQueuedMessages,
  flushQueuedMessages,
  interruptChat,
  editAndForkMessage,
  loadConversation,
} from '../chatSlice';
import { setAllowChatQueue } from '../uiSlice';
import type { RootState } from '../store';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { waitFor, getTestDbPath, createNextRequest, setupTestStore } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch, commonInterceptors } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { parseLogToMessages } from '@/lib/conversations-utils';
import type { ConversationFile } from '@/lib/conversations';

// Unified test database mock (test name must match)
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const TEST_DB_PATH = getTestDbPath('chat_api');
const INTERRUPTION_TEST_DB_PATH = getTestDbPath('chat_interruption');
const QUEUE_TEST_DB_PATH = getTestDbPath('chat_queue');
const EDIT_FORK_TEST_DB_PATH = getTestDbPath('edit_and_fork');

// ============================================================================
// Suite 1+2: Chat API Handler + Redux Orchestration (original chatE2E.test.ts)
// ============================================================================

describe('Chat API Tests', () => {
  // Single Python backend + mock fetch shared by all inner describe blocks
  const { getPythonPort } = withPythonBackend();
  const mockFetch = setupMockFetch({
    getPythonPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler
      }
    ]
  });

  // ============================================================================
  // Suite 1: Chat API Handler Tests (formerly route.test.ts)
  // Tests the HTTP API handler directly — no Redux layer.
  // ============================================================================

  describe('Chat API - Handler Tests', () => {
    setupTestDb(TEST_DB_PATH);

    beforeEach(() => {
      mockFetch.mockClear();
    });

    it('should handle full conversation flow with MultiToolAgent', async () => {
      // STEP 1: Initial message - dispatches UserInputTool + UserInputToolBackend
      const response1 = await chatPostHandler(createNextRequest({
        user_message: 'Testing',
        agent: 'MultiToolAgent',
        agent_args: { goal: 'Testing' }
      }));
      const data1 = await response1.json();

      console.log('Step 1 response:', JSON.stringify(data1, null, 2));

      expect(response1.status).toBe(200);
      expect(data1.conversationID).toBeDefined();
      expect(data1.error).toBeNull();
      expect(data1.pending_tool_calls.length).toBe(1);
      expect(data1.pending_tool_calls[0].function.name).toBe('UserInputTool');
      expect(data1.completed_tool_calls.length).toBe(1);
      expect(data1.completed_tool_calls[0].function.name).toBe('UserInputToolBackend');
      expect(data1.completed_tool_calls[0].content).toBe('Backend executed tool response');

      const conversationID = data1.conversationID;
      const log_index1 = data1.log_index;
      const pendingToolCall = data1.pending_tool_calls[0];

      // STEP 2: Complete UserInputTool
      const response2 = await chatPostHandler(createNextRequest({
        conversationID,
        log_index: log_index1,
        user_message: null,
        completed_tool_calls: [
          [pendingToolCall, { role: 'tool', tool_call_id: pendingToolCall.id, content: 'User provided input' }]
        ],
        agent: 'MultiToolAgent',
        agent_args: {}
      }));
      const data2 = await response2.json();

      console.log('Step 2 response:', JSON.stringify(data2, null, 2));

      expect(response2.status).toBe(200);
      expect(data2.conversationID).toBe(conversationID);
      expect(data2.error).toBeNull();
      expect(data2.pending_tool_calls.length).toBe(0);
      expect(data2.completed_tool_calls.length).toBe(2);

      const userInputCompletion = data2.completed_tool_calls.find((c: any) => c.function.name === 'UserInputTool');
      expect(userInputCompletion).toBeDefined();
      expect(userInputCompletion.content).toBe('User provided input');

      const parentCompletion = data2.completed_tool_calls.find((c: any) => c.function.name === 'MultiToolAgent');
      expect(parentCompletion).toBeDefined();
      expect(parentCompletion.content).toBe('All tools completed');

      const log_index2 = data2.log_index;

      // STEP 3: Continue conversation (tests history access)
      const response3 = await chatPostHandler(createNextRequest({
        conversationID,
        log_index: log_index2,
        user_message: 'Continue conversation',
        agent: 'MultiToolAgent',
        agent_args: { goal: 'second-call' }
      }));
      const data3 = await response3.json();

      console.log('Step 3 response:', JSON.stringify(data3, null, 2));

      expect(response3.status).toBe(200);
      expect(data3.conversationID).toBe(conversationID);
      expect(data3.error).toBeNull();
      expect(data3.log_index).toBeGreaterThan(log_index2);
      expect(data3.pending_tool_calls.length).toBe(0);
      expect(data3.completed_tool_calls.length).toBe(1);

      const multiToolCompletion = data3.completed_tool_calls[0];
      expect(multiToolCompletion.function.name).toBe('MultiToolAgent');
      expect(parseInt(multiToolCompletion.content)).toBeGreaterThan(0);

      // STEP 4: Test forking (stale log_index)
      const response4 = await chatPostHandler(createNextRequest({
        conversationID,
        log_index: log_index2,  // Stale index!
        user_message: 'Fork test',
        agent: 'MultiToolAgent',
        agent_args: { goal: 'fork-test' }
      }));
      const data4 = await response4.json();

      console.log('Step 4 response (fork):', JSON.stringify(data4, null, 2));

      expect(response4.status).toBe(200);
      expect(data4.conversationID).not.toBe(conversationID);  // NEW conversation ID!
      expect(data4.error).toBeNull();
      expect(data4.pending_tool_calls.length).toBe(0);
      expect(data4.completed_tool_calls.length).toBe(1);

      const forkCompletion = data4.completed_tool_calls[0];
      expect(forkCompletion.function.name).toBe('MultiToolAgent');

      // STEP 5: Test error handling
      const response5 = await chatPostHandler(createNextRequest({
        user_message: 'Test error',
        agent: 'NonExistentAgent',
        agent_args: {}
      }));
      const data5 = await response5.json();

      expect(response5.status).toBe(200);
      expect(data5.error).toContain('not found');
      expect(data5.pending_tool_calls).toEqual([]);
      expect(data5.completed_tool_calls).toEqual([]);
    });

    it('should handle auth errors', async () => {
      const { getEffectiveUser } = require('@/lib/auth/auth-helpers');
      getEffectiveUser.mockResolvedValueOnce(null);

      const response = await chatPostHandler(createNextRequest({
        user_message: 'Test message',
        agent: 'DefaultAgent',
        agent_args: {}
      }));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Not authenticated');
    });
  });

  // ============================================================================
  // Suite 2: Chat E2E Redux Orchestration (formerly chatE2E.test.ts)
  // Tests the full Redux → Listener Middleware → API → Python Backend stack.
  // ============================================================================

  describe('Chat E2E - Redux Orchestration', () => {
    const { getStore } = setupTestDb(TEST_DB_PATH);

    it('should handle basic conversation flow with MultiToolAgent (mirrors backend test)', async () => {
      const store = getStore();

      const conversationID = -123; // Temp conversation ID (negative)

      // STEP 1: Create conversation
      store.dispatch(createConversation({
        conversationID,
        agent: 'MultiToolAgent',
        agent_args: { goal: 'Testing' }
      }));

      let conv = selectConversation(store.getState() as RootState, conversationID);
      expect(conv).toBeDefined();
      expect(conv!.executionState).toBe('FINISHED');
      expect(conv!.messages).toHaveLength(0);

      // STEP 2: User sends message, agent dispatches UserInputTool + UserInputToolBackend
      store.dispatch(sendMessage({
        conversationID,
        message: 'Testing'
      }));

      // State should immediately update with user message and WAITING
      conv = selectConversation(store.getState() as RootState, conversationID);
      expect(conv!.executionState).toBe('WAITING');
      expect(conv!.messages).toHaveLength(1);
      expect(conv!.messages[0].role).toBe('user');
      if (conv!.messages[0].role === 'user') {
        expect(conv!.messages[0].content).toBe('Testing');
        expect(conv!.messages[0].created_at).toBeDefined();
      }

      // STEP 3: Wait for conversation to be created and possibly have pending tools
      let realConversationID = conversationID;
      await waitFor(() => {
        const tempConv = selectConversation(store.getState() as RootState, conversationID);
        if (tempConv?.forkedConversationID) {
          realConversationID = tempConv.forkedConversationID;
        }
        const c = selectConversation(store.getState() as RootState, realConversationID);
        return c?.executionState === 'FINISHED' || c?.executionState === 'EXECUTING';
      }, 10000);

      // Complete any pending tools
      conv = selectConversation(store.getState() as RootState, realConversationID);
      if (conv?.executionState === 'EXECUTING') {
        for (const pending of conv.pending_tool_calls) {
          if (!pending.result) {
            store.dispatch(completeToolCall({
              conversationID: realConversationID,
              tool_call_id: pending.toolCall.id,
              result: {
                role: 'tool',
                tool_call_id: pending.toolCall.id,
                content: 'User provided input',
                created_at: new Date().toISOString()
              }
            }));
          }
        }
        await waitFor(() => {
          const c = selectConversation(store.getState() as RootState, realConversationID);
          return c?.executionState === 'FINISHED';
        }, 10000);
      }

      conv = selectConversation(store.getState() as RootState, realConversationID);

      // STEP 4: Verify all tools completed
      expect(conv!.executionState).toBe('FINISHED');
      expect(conv!.pending_tool_calls.length).toBe(0);
      expect(conv!.error).toBeUndefined();
      expect(conv!.log_index).toBeGreaterThan(0);

      // Should have completions for: UserInputToolBackend (backend) + UserInputTool (frontend) + MultiToolAgent (parent)
      const backendToolCompletion = conv!.messages.find(m =>
        m.role === 'tool' && m.function?.name === 'UserInputToolBackend'
      );
      expect(backendToolCompletion).toBeDefined();
      if (backendToolCompletion?.role === 'tool') {
        expect(backendToolCompletion.content).toBe('Backend executed tool response');
      }

      const frontendToolCompletion = conv!.messages.find(m =>
        m.role === 'tool' && m.function?.name === 'UserInputTool'
      );
      expect(frontendToolCompletion).toBeDefined();
      if (frontendToolCompletion?.role === 'tool') {
        expect(frontendToolCompletion.content).toBe('User provided input');
      }

      const parentCompletion = conv!.messages.find(m =>
        m.role === 'tool' && m.function?.name === 'MultiToolAgent'
      );
      expect(parentCompletion).toBeDefined();
      if (parentCompletion?.role === 'tool') {
        expect(parentCompletion.content).toBe('All tools completed');
      }
    });

    it('should handle conversation continuation and forking', async () => {
      const store = getStore();

      const conversationID = -456; // Temp conversation ID (negative)

      // STEP 1: Create and complete first exchange
      store.dispatch(createConversation({
        conversationID,
        agent: 'MultiToolAgent',
        agent_args: { goal: 'first-call' }
      }));

      store.dispatch(sendMessage({ conversationID, message: 'First message' }));

      let realConversationID = conversationID;
      await waitFor(() => {
        const tempConv = selectConversation(store.getState() as RootState, conversationID);
        if (tempConv?.forkedConversationID) {
          realConversationID = tempConv.forkedConversationID;
        }
        const c = selectConversation(store.getState() as RootState, realConversationID);
        return c?.executionState === 'FINISHED' || c?.executionState === 'EXECUTING';
      }, 10000);

      // Complete any pending tools
      let conv = selectConversation(store.getState() as RootState, realConversationID);
      if (conv?.executionState === 'EXECUTING') {
        for (const pending of conv.pending_tool_calls) {
          if (!pending.result) {
            store.dispatch(completeToolCall({
              conversationID: realConversationID,
              tool_call_id: pending.toolCall.id,
              result: {
                role: 'tool',
                tool_call_id: pending.toolCall.id,
                content: 'User input for first call',
                created_at: new Date().toISOString()
              }
            }));
          }
        }
        await waitFor(() => {
          const c = selectConversation(store.getState() as RootState, realConversationID);
          return c?.executionState === 'FINISHED';
        }, 10000);
      }

      conv = selectConversation(store.getState() as RootState, realConversationID);
      const log_index2 = conv!.log_index;  // Save for forking test later

      // STEP 2: Continue conversation (tests that agent can access previous history)
      store.dispatch(sendMessage({ conversationID: realConversationID, message: 'Second message' }));

      await waitFor(() => {
        const c = selectConversation(store.getState() as RootState, realConversationID);
        return (c?.log_index || 0) > log_index2;
      }, 10000);

      // Complete any new pending tools
      conv = selectConversation(store.getState() as RootState, realConversationID);
      if (conv?.executionState === 'EXECUTING') {
        for (const pending of conv.pending_tool_calls) {
          if (!pending.result) {
            store.dispatch(completeToolCall({
              conversationID: realConversationID,
              tool_call_id: pending.toolCall.id,
              result: {
                role: 'tool',
                tool_call_id: pending.toolCall.id,
                content: 'User input for second call',
                created_at: new Date().toISOString()
              }
            }));
          }
        }
        await waitFor(() => {
          const c = selectConversation(store.getState() as RootState, realConversationID);
          return c?.executionState === 'FINISHED';
        }, 10000);
      }

      conv = selectConversation(store.getState() as RootState, realConversationID);
      expect(conv!.executionState).toBe('FINISHED');
      expect(conv!.log_index).toBeGreaterThan(log_index2);

      // STEP 3: Test forking - manually reset log_index and send message
      const staleLogIndex = log_index2;  // Use log_index from Step 1

      conv = selectConversation(store.getState() as RootState, realConversationID);
      const messagesBeforeFork = conv!.messages.length;

      store.dispatch(updateConversation({
        conversationID: realConversationID,
        log_index: staleLogIndex,
        completed_tool_calls: [],
        pending_tool_calls: []
      }));

      store.dispatch(sendMessage({ conversationID: realConversationID, message: 'Fork test' }));

      await new Promise(resolve => setTimeout(resolve, 2000));

      const allConversations = (store.getState() as RootState).chat.conversations;
      const originalExists = selectConversation(store.getState() as RootState, realConversationID);

      const forkedConv = Object.values(allConversations).find((c: any) =>
        c.conversationID !== realConversationID &&
        c.conversationID > 0 &&
        c.conversationID !== conversationID
      );

      if (forkedConv) {
        expect(originalExists).toBeDefined();
        expect(forkedConv.conversationID).not.toBe(realConversationID);
        expect(forkedConv.log_index).toBeGreaterThan(0);
        expect(forkedConv.messages.length).toBeGreaterThan(0);
      } else {
        expect(originalExists).toBeDefined();
        expect(originalExists!.messages.length).toBeGreaterThan(messagesBeforeFork);
      }
    });

    it('should handle error responses gracefully', async () => {
      const store = getStore();
      const conversationID = -789; // Temp conversation ID (negative)

      store.dispatch(createConversation({
        conversationID,
        agent: 'NonExistentAgent',  // This will cause an error
        agent_args: {}
      }));

      store.dispatch(sendMessage({ conversationID, message: 'Test error' }));

      await waitFor(() => {
        const c = selectConversation(store.getState() as RootState, conversationID);
        return c?.executionState === 'FINISHED';
      }, 10000);

      const conv = selectConversation(store.getState() as RootState, conversationID);
      expect(conv!.error).toBeDefined();
      expect(conv!.error).toContain('not found');
      expect(conv!.executionState).toBe('FINISHED');
    });

  });
});

// ============================================================================
// Suites 3, 4, 6: Shared LLM Mock Backend (one Python startup for all three)
// ============================================================================

describe('LLM-Mocked Agent Suites', () => {
  const { getPythonPort: sharedPythonPort, getLLMMockPort, getLLMMockServer } =
    withPythonBackend({ withLLMMock: true });

  const sharedLLMMockFetch = setupMockFetch({
    getPythonPort: sharedPythonPort,
    getLLMMockPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler,
      },
    ],
    additionalInterceptors: [
      commonInterceptors.mockQuerySales,
      commonInterceptors.mockSchemaSales,
    ],
  });

  // ============================================================================
  // Suite 3: Agent E2E with Dynamic LLM Mocking (chatAnalystDynamic.test.ts)
  // ============================================================================

  describe('Agent - E2E with Dynamic LLM Mocking', () => {
  const { getStore: getAnalystDynStore } = setupTestDb(getTestDbPath('atlas_analyst_dyn'), { withTestConnection: true });

  beforeEach(async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();
    sharedLLMMockFetch.mockClear();
  });

  it('should complete conversation with immediate response (no tools)', async () => {
    const store = getAnalystDynStore();
    const mockServer = getLLMMockServer!();
    const conversationID = -100; // Temp conversation ID (negative)

    await mockServer.configure({
      response: {
        content: "Here's the sales data you requested.",
        role: 'assistant',
        tool_calls: [],
        finish_reason: 'stop'
      },
      usage: { total_tokens: 150, prompt_tokens: 100, completion_tokens: 50 }
    });

    store.dispatch(createConversation({
      conversationID,
      agent: 'AnalystAgent',
      agent_args: {
        goal: 'Show me a chart of sales by region',
        connection_id: 'test_connection'
      }
    }));

    store.dispatch(sendMessage({ conversationID, message: 'Show me a chart of sales by region' }));

    let realConversationID = conversationID;
    await waitFor(() => {
      const tempConv = selectConversation(store.getState() as RootState, conversationID);
      if (tempConv?.forkedConversationID) {
        realConversationID = tempConv.forkedConversationID;
      }
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED';
    }, 45000);

    const conv = selectConversation(store.getState() as RootState, realConversationID);
    expect(conv!.executionState).toBe('FINISHED');
    expect(conv!.error).toBeUndefined();

    const calls = await mockServer.getCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);
  }, 45000);

  it('should handle multi-turn conversation with tool calls and history', async () => {
    const store = getAnalystDynStore();
    const mockServer = getLLMMockServer!();
    const conversationID = -200;

    await mockServer.configure([
      {
        validateRequest: (req) => {
          const getText = (content: any): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n\n');
            return '';
          };
          console.log('\n=== Turn 1 History ===');
          req.messages.forEach((m: any, i: number) => {
            const contentPreview = getText(m.content).substring(0, 50) || m.tool_call_id || '[tool_calls]';
            console.log(`${i}: ${m.role} - ${contentPreview}`);
          });
          console.log('======================\n');
          expect(req.messages.length).toBe(2);
          expect(req.messages[0].role).toBe('system');
          expect(req.messages[1].role).toBe('user');
          expect(getText(req.messages[1].content)).toContain('sales by region');
          expect(req.tools).toBeDefined();
          expect(req.tools!.length).toBeGreaterThan(0);
          const toolNames = req.tools!.map((t: any) => t.function.name);
          expect(toolNames).toContain('SearchDBSchema');
          expect(toolNames).toContain('EditFile');
          return true;
        },
        response: {
          content: "I'll search the schema to find sales data.",
          role: 'assistant',
          tool_calls: [{ id: 'call_001', type: 'function', function: { name: 'SearchDBSchema', arguments: JSON.stringify({ query: 'SalesTerritory', connection_id: 'test_connection' }) } }],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 100, prompt_tokens: 50, completion_tokens: 50 }
      },
      {
        validateRequest: (req) => {
          const getText = (content: any): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n\n');
            return '';
          };
          console.log('\n=== Turn 2 History ===');
          req.messages.forEach((m: any, i: number) => {
            const contentPreview = getText(m.content).substring(0, 50) || m.tool_call_id || '[tool_calls]';
            console.log(`${i}: ${m.role} - ${contentPreview}`);
          });
          console.log('======================\n');
          expect(req.messages.length).toBe(4);
          expect(req.messages[0].role).toBe('system');
          expect(req.messages[1].role).toBe('user');
          expect(req.messages[2].role).toBe('assistant');
          expect(req.messages[3].role).toBe('tool');
          expect(req.messages[3].tool_call_id).toBe('call_001');
          expect(req.messages[3].content).toBeDefined();
          return true;
        },
        response: {
          content: "Based on the schema, I can see the sales territory data. Here's your chart.",
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop'
        },
        usage: { total_tokens: 120, prompt_tokens: 80, completion_tokens: 40 }
      },
      {
        validateRequest: (req) => {
          const getText = (content: any): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n\n');
            return '';
          };
          console.log('\n=== Turn 3 History ===');
          req.messages.forEach((m: any, i: number) => {
            const contentPreview = getText(m.content).substring(0, 50) || m.tool_call_id || '[tool_calls]';
            console.log(`${i}: ${m.role} - ${contentPreview}`);
          });
          console.log('======================\n');
          expect(req.messages.length).toBe(6);
          expect(req.messages[0].role).toBe('system');
          expect(req.messages[1].role).toBe('user');
          expect(req.messages[2].role).toBe('assistant');
          expect(req.messages[3].role).toBe('tool');
          expect(req.messages[4].role).toBe('assistant');
          expect(req.messages[5].role).toBe('user');
          return true;
        },
        response: {
          content: "The Northwest region had strong performance too.",
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop'
        },
        usage: { total_tokens: 100, prompt_tokens: 85, completion_tokens: 15 }
      }
    ]);

    store.dispatch(createConversation({
      conversationID,
      agent: 'AnalystAgent',
      agent_args: { goal: 'Show me a chart of sales by region', connection_id: 'test_connection' }
    }));

    store.dispatch(sendMessage({ conversationID, message: 'Show me a chart of sales by region' }));

    let realConversationID = conversationID;
    await waitFor(() => {
      const tempConv = selectConversation(store.getState() as RootState, conversationID);
      if (tempConv?.forkedConversationID) {
        realConversationID = tempConv.forkedConversationID;
      }
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED';
    }, 45000);

    let conv = selectConversation(store.getState() as RootState, realConversationID);
    expect(conv!.executionState).toBe('FINISHED');
    expect(conv!.error).toBeUndefined();

    const nonDebugMessages = conv!.messages?.filter((m: any) => m.role !== 'debug') || [];
    expect(nonDebugMessages.length).toBe(4);
    const toolMessages = conv!.messages?.filter((m: any) => m.role === 'tool') || [];
    expect(toolMessages.length).toBe(3);

    const schemaSearchTool = toolMessages.find((m: any) => m.function?.name === 'SearchDBSchema');
    expect(schemaSearchTool).toBeDefined();

    store.dispatch(sendMessage({ conversationID: realConversationID, message: 'What about Northwest region?' }));

    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, realConversationID);
      const nonDebug = c?.messages?.filter((m: any) => m.role !== 'debug') || [];
      return c?.executionState === 'FINISHED' && nonDebug.length === 6;
    }, 45000);

    conv = selectConversation(store.getState() as RootState, realConversationID);
    expect(conv!.executionState).toBe('FINISHED');
    const nonDebugAfterSecond = conv!.messages?.filter((m: any) => m.role !== 'debug') || [];
    expect(nonDebugAfterSecond.length).toBe(6);

    const calls = await mockServer.getCalls();
    expect(calls.length).toBe(3);
  }, 45000);
});

// ============================================================================
// Suite 4: Chat Interruption & Error Recovery E2E (chatInterruptionE2E.test.ts)
// ============================================================================

  describe('Chat Interruption & Error Recovery E2E', () => {
  setupTestDb(INTERRUPTION_TEST_DB_PATH);

  beforeEach(async () => {
    sharedLLMMockFetch.mockClear();
    await getLLMMockServer!().reset();
  });

  it('UserInputTool interrupted by new message — LLM receives valid paired tool_use/tool_result history', async () => {
    const response1 = await chatPostHandler(createNextRequest({
      user_message: 'What is revenue?',
      agent: 'MultiToolAgent',
      agent_args: { goal: 'What is revenue?' }
    }));
    const r1 = await response1.json();

    console.log('[Test 1] Step 1 response:', JSON.stringify(r1, null, 2));

    expect(response1.status).toBe(200);
    expect(r1.error).toBeNull();
    expect(r1.pending_tool_calls).toHaveLength(1);
    expect(r1.pending_tool_calls[0].function.name).toBe('UserInputTool');
    expect(r1.completed_tool_calls).toHaveLength(1);
    expect(r1.completed_tool_calls[0].function.name).toBe('UserInputToolBackend');

    const conversationID = r1.conversationID;
    const logIndex = r1.log_index;

    await getLLMMockServer!().configure({
      validateRequest: (req) => {
        const messages = req.messages;
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              const hasResult = messages.slice(i + 1).some((m: any) => m.role === 'tool' && m.tool_call_id === tc.id);
              if (!hasResult) throw new Error('Missing tool_result for tool_call_id=' + tc.id + ' (tool: ' + (tc.function && tc.function.name) + ')');
            }
          }
        }
        for (let i = 1; i < messages.length; i++) {
          if (messages[i].role === 'assistant' && messages[i - 1].role === 'assistant') throw new Error('Consecutive assistant messages at indices ' + (i - 1) + ' and ' + i);
        }
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'tool' && msg.tool_call_id) {
            const hasCall = messages.slice(0, i).some((m: any) => m.role === 'assistant' && m.tool_calls && m.tool_calls.some((tc: any) => tc.id === msg.tool_call_id));
            if (!hasCall) throw new Error('tool_result at index ' + i + ' has no preceding tool_call: id=' + msg.tool_call_id);
          }
        }
        const hasInterrupted = messages.some((m: any) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('<Interrupted />'));
        if (!hasInterrupted) throw new Error('Expected at least one tool_result with <Interrupted /> content');
        return true;
      },
      response: { content: 'Revenue for last quarter was $4.2M.', role: 'assistant', tool_calls: [], finish_reason: 'stop' },
      usage: { total_tokens: 60, prompt_tokens: 50, completion_tokens: 10 }
    });

    const response2 = await chatPostHandler(createNextRequest({
      conversationID,
      log_index: logIndex,
      user_message: 'Actually show me top customers instead',
      agent: 'AnalystAgent',
      agent_args: { goal: 'Actually show me top customers instead' }
    }));
    const r2 = await response2.json();

    console.log('[Test 1] Step 2 response:', JSON.stringify(r2, null, 2));

    expect(response2.status).toBe(200);
    expect(r2.error).toBeNull();

    const calls = await getLLMMockServer!().getCalls();
    expect(calls).toHaveLength(1);
  });

  it('LLM error returns logDiff=[] — recovery message sees interrupted tool in valid history', async () => {
    const response1 = await chatPostHandler(createNextRequest({
      user_message: 'What is revenue?',
      agent: 'MultiToolAgent',
      agent_args: { goal: 'What is revenue?' }
    }));
    const r1 = await response1.json();

    console.log('[Test 2] Step 1 response:', JSON.stringify(r1, null, 2));

    expect(response1.status).toBe(200);
    expect(r1.error).toBeNull();
    expect(r1.pending_tool_calls).toHaveLength(1);
    expect(r1.pending_tool_calls[0].function.name).toBe('UserInputTool');

    const conversationID = r1.conversationID;
    const logIndex = r1.log_index;

    const response2 = await chatPostHandler(createNextRequest({
      conversationID,
      log_index: logIndex,
      user_message: 'What are top customers?',
      agent: 'AnalystAgent',
      agent_args: { goal: 'What are top customers?' }
    }));
    const r2 = await response2.json();

    console.log('[Test 2] Step 2 response (expected error):', JSON.stringify(r2, null, 2));

    expect(r2.error).toBeTruthy();
    expect(r2.log_index).toBe(logIndex);
    expect(r2.conversationID).toBe(conversationID);

    await getLLMMockServer!().configure({
      validateRequest: (req) => {
        const messages = req.messages;
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              const hasResult = messages.slice(i + 1).some((m: any) => m.role === 'tool' && m.tool_call_id === tc.id);
              if (!hasResult) throw new Error('Missing tool_result for tool_call_id=' + tc.id + ' (tool: ' + (tc.function && tc.function.name) + ')');
            }
          }
        }
        for (let i = 1; i < messages.length; i++) {
          if (messages[i].role === 'assistant' && messages[i - 1].role === 'assistant') throw new Error('Consecutive assistant messages at indices ' + (i - 1) + ' and ' + i);
        }
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'tool' && msg.tool_call_id) {
            const hasCall = messages.slice(0, i).some((m: any) => m.role === 'assistant' && m.tool_calls && m.tool_calls.some((tc: any) => tc.id === msg.tool_call_id));
            if (!hasCall) throw new Error('tool_result at index ' + i + ' has no preceding tool_call: id=' + msg.tool_call_id);
          }
        }
        const hasInterrupted = messages.some((m: any) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('<Interrupted />'));
        if (!hasInterrupted) throw new Error('Expected tool_result with <Interrupted /> content — DB log was not modified by the earlier error (logDiff=[]), so UserInputTool should still be pending and get interrupted');
        return true;
      },
      response: { content: 'Top 5 customers by revenue: Alice ($1.2M), Bob ($0.9M)...', role: 'assistant', tool_calls: [], finish_reason: 'stop' },
      usage: { total_tokens: 80, prompt_tokens: 70, completion_tokens: 10 }
    });

    const response3 = await chatPostHandler(createNextRequest({
      conversationID: r2.conversationID,
      log_index: r2.log_index,
      user_message: 'Give me the top 5 customers by revenue',
      agent: 'AnalystAgent',
      agent_args: { goal: 'Give me the top 5 customers by revenue' }
    }));
    const r3 = await response3.json();

    console.log('[Test 2] Step 3 response (recovery):', JSON.stringify(r3, null, 2));

    expect(response3.status).toBe(200);
    expect(r3.error).toBeNull();
    expect(r3.log_index).toBeGreaterThan(logIndex);

    const calls = await getLLMMockServer!().getCalls();
    expect(calls).toHaveLength(1);
  });

  it('Clarify (FrontendToolException) interrupted — parent Clarify gets <Interrupted /> so LLM history is valid', async () => {
    const clarifyId = 'test_clarify_id_001';
    await getLLMMockServer!().configure({
      response: {
        content: '',
        role: 'assistant',
        tool_calls: [{ id: clarifyId, type: 'function', function: { name: 'Clarify', arguments: JSON.stringify({ question: 'Which metric do you want to analyze?', options: [{ label: 'Revenue' }, { label: 'Orders' }], multiSelect: false }) } }],
        finish_reason: 'tool_calls'
      },
      usage: { total_tokens: 30, prompt_tokens: 20, completion_tokens: 10 }
    });

    const response1 = await chatPostHandler(createNextRequest({
      user_message: 'Show me performance metrics',
      agent: 'AnalystAgent',
      agent_args: { goal: 'Show me performance metrics' }
    }));
    const r1 = await response1.json();

    console.log('[Test 3] Step 1 response:', JSON.stringify(r1, null, 2));

    expect(response1.status).toBe(200);
    expect(r1.error).toBeNull();
    expect(r1.pending_tool_calls).toHaveLength(1);
    expect(r1.pending_tool_calls[0].function.name).toBe('ClarifyFrontend');
    expect(r1.pending_tool_calls[0]._parent_unique_id).toBe(clarifyId);

    const conversationID = r1.conversationID;
    const logIndex = r1.log_index;

    await getLLMMockServer!().configure({
      validateRequest: (req) => {
        const messages = req.messages;
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              const hasResult = messages.slice(i + 1).some((m: any) => m.role === 'tool' && m.tool_call_id === tc.id);
              if (!hasResult) throw new Error('Missing tool_result for tool_call_id=' + tc.id + ' (tool: ' + (tc.function && tc.function.name) + ')');
            }
          }
        }
        for (let i = 1; i < messages.length; i++) {
          if (messages[i].role === 'assistant' && messages[i - 1].role === 'assistant') throw new Error('Consecutive assistant messages at indices ' + (i - 1) + ' and ' + i);
        }
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'tool' && msg.tool_call_id) {
            const hasCall = messages.slice(0, i).some((m: any) => m.role === 'assistant' && m.tool_calls && m.tool_calls.some((tc: any) => tc.id === msg.tool_call_id));
            if (!hasCall) throw new Error('tool_result at index ' + i + ' has no preceding tool_call: id=' + msg.tool_call_id);
          }
        }
        const hasClarifyInterrupted = messages.some((m: any) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('<Interrupted />'));
        if (!hasClarifyInterrupted) throw new Error('Expected a tool_result with <Interrupted /> for the Clarify tool.');
        return true;
      },
      response: { content: 'I can show you both Revenue and Orders metrics.', role: 'assistant', tool_calls: [], finish_reason: 'stop' },
      usage: { total_tokens: 60, prompt_tokens: 50, completion_tokens: 10 }
    });

    const response2 = await chatPostHandler(createNextRequest({
      conversationID,
      log_index: logIndex,
      user_message: 'Never mind, just show me revenue',
      agent: 'AnalystAgent',
      agent_args: { goal: 'Never mind, just show me revenue' }
    }));
    const r2 = await response2.json();

    console.log('[Test 3] Step 2 response:', JSON.stringify(r2, null, 2));

    expect(response2.status).toBe(200);
    expect(r2.error).toBeNull();

    const calls = await getLLMMockServer!().getCalls();
    expect(calls).toHaveLength(2);
  });

  it('ReadFiles (non-Clarify frontend tool) interrupted by new message — LLM receives valid history', async () => {
    const readFilesId = 'test_readfiles_id_001';

    await getLLMMockServer!().configure({
      response: {
        content: '',
        role: 'assistant',
        tool_calls: [{ id: readFilesId, type: 'function', function: { name: 'ReadFiles', arguments: JSON.stringify({ fileIds: [42] }) } }],
        finish_reason: 'tool_calls'
      },
      usage: { total_tokens: 30, prompt_tokens: 20, completion_tokens: 10 }
    });

    const response1 = await chatPostHandler(createNextRequest({
      user_message: 'Show me file 42',
      agent: 'AnalystAgent',
      agent_args: { goal: 'Show me file 42' }
    }));
    const r1 = await response1.json();

    console.log('[Test 4] Step 1 response:', JSON.stringify(r1, null, 2));

    expect(response1.status).toBe(200);
    expect(r1.error).toBeNull();
    expect(r1.pending_tool_calls).toHaveLength(1);
    expect(r1.pending_tool_calls[0].function.name).toBe('ReadFiles');
    expect(r1.pending_tool_calls[0].id).toBe(readFilesId);

    const conversationID = r1.conversationID;
    const logIndex = r1.log_index;

    await getLLMMockServer!().configure({
      validateRequest: (req) => {
        const messages = req.messages;
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              const hasResult = messages.slice(i + 1).some((m: any) => m.role === 'tool' && m.tool_call_id === tc.id);
              if (!hasResult) throw new Error('Missing tool_result for tool_call_id=' + tc.id + ' (tool: ' + (tc.function && tc.function.name) + ')');
            }
          }
        }
        for (let i = 1; i < messages.length; i++) {
          if (messages[i].role === 'assistant' && messages[i - 1].role === 'assistant') throw new Error('Consecutive assistant messages at indices ' + (i - 1) + ' and ' + i);
        }
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'tool' && msg.tool_call_id) {
            const hasCall = messages.slice(0, i).some((m: any) => m.role === 'assistant' && m.tool_calls && m.tool_calls.some((tc: any) => tc.id === msg.tool_call_id));
            if (!hasCall) throw new Error('tool_result at index ' + i + ' has no preceding tool_call: id=' + msg.tool_call_id);
          }
        }
        const hasInterrupted = messages.some((m: any) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('<Interrupted />'));
        if (!hasInterrupted) throw new Error('Expected a tool_result with <Interrupted /> for ReadFiles.');
        const readFilesInterrupted = messages.some((m: any) => m.role === 'tool' && m.tool_call_id === 'test_readfiles_id_001' && typeof m.content === 'string' && m.content.includes('<Interrupted />'));
        if (!readFilesInterrupted) throw new Error('Expected tool_result for ReadFiles (id=test_readfiles_id_001) to contain <Interrupted />');
        return true;
      },
      response: { content: 'I can help you with that instead.', role: 'assistant', tool_calls: [], finish_reason: 'stop' },
      usage: { total_tokens: 50, prompt_tokens: 40, completion_tokens: 10 }
    });

    const response2 = await chatPostHandler(createNextRequest({
      conversationID,
      log_index: logIndex,
      user_message: 'Never mind, just answer my question directly',
      agent: 'AnalystAgent',
      agent_args: { goal: 'Never mind, just answer my question directly' }
    }));
    const r2 = await response2.json();

    console.log('[Test 4] Step 2 response:', JSON.stringify(r2, null, 2));

    expect(response2.status).toBe(200);
    expect(r2.error).toBeNull();

    const calls = await getLLMMockServer!().getCalls();
    expect(calls).toHaveLength(2);
  });

  it('Completed turn + LLM error on subsequent turn — user can continue conversation cleanly', async () => {
    await getLLMMockServer!().configure({
      response: { content: 'Revenue for Q3 was $4.2M.', role: 'assistant', tool_calls: [], finish_reason: 'stop' },
      usage: { total_tokens: 40, prompt_tokens: 30, completion_tokens: 10 }
    });

    const response1 = await chatPostHandler(createNextRequest({
      user_message: 'What was revenue in Q3?',
      agent: 'AnalystAgent',
      agent_args: { goal: 'What was revenue in Q3?' }
    }));
    const r1 = await response1.json();

    console.log('[Test 5] Step 1 response (success):', JSON.stringify(r1, null, 2));

    expect(response1.status).toBe(200);
    expect(r1.error).toBeNull();
    expect(r1.pending_tool_calls).toHaveLength(0);

    const conversationID = r1.conversationID;
    const logIndex = r1.log_index;

    const response2 = await chatPostHandler(createNextRequest({
      conversationID,
      log_index: logIndex,
      user_message: 'What about Q4?',
      agent: 'AnalystAgent',
      agent_args: { goal: 'What about Q4?' }
    }));
    const r2 = await response2.json();

    console.log('[Test 5] Step 2 response (expected LLM error):', JSON.stringify(r2, null, 2));

    expect(r2.error).toBeTruthy();
    expect(r2.log_index).toBe(logIndex);
    expect(r2.conversationID).toBe(conversationID);
    expect(r2.pending_tool_calls).toHaveLength(0);

    await getLLMMockServer!().configure({
      validateRequest: (req) => {
        const messages = req.messages;
        for (let i = 1; i < messages.length; i++) {
          if (messages[i].role === messages[i - 1].role && messages[i].role !== 'system') throw new Error('Consecutive ' + messages[i].role + ' messages at indices ' + (i - 1) + ' and ' + i);
        }
        const hasMsg1 = messages.some((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('Q3'));
        if (!hasMsg1) throw new Error('Turn 1 user message (Q3) not found in history for Turn 3 LLM call');
        const hasResponse1 = messages.some((m: any) => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('$4.2M'));
        if (!hasResponse1) throw new Error('Turn 1 assistant response ($4.2M) not found in history for Turn 3 LLM call');
        const hasMsg3 = messages.some((m: any) => {
          if (m.role !== 'user') return false;
          const text = Array.isArray(m.content) ? m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : typeof m.content === 'string' ? m.content : '';
          return text.includes('Q4');
        });
        if (!hasMsg3) throw new Error('Turn 3 user message (Q4) not found as current message');
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              const hasResult = messages.slice(i + 1).some((m: any) => m.role === 'tool' && m.tool_call_id === tc.id);
              if (!hasResult) throw new Error('Missing tool_result for tool_call_id=' + tc.id);
            }
          }
        }
        return true;
      },
      response: { content: 'Revenue for Q4 was $5.1M.', role: 'assistant', tool_calls: [], finish_reason: 'stop' },
      usage: { total_tokens: 60, prompt_tokens: 50, completion_tokens: 10 }
    });

    const response3 = await chatPostHandler(createNextRequest({
      conversationID: r2.conversationID,
      log_index: r2.log_index,
      user_message: 'What about Q4?',
      agent: 'AnalystAgent',
      agent_args: { goal: 'What about Q4?' }
    }));
    const r3 = await response3.json();

    console.log('[Test 5] Step 3 response (recovery):', JSON.stringify(r3, null, 2));

    expect(response3.status).toBe(200);
    expect(r3.error).toBeNull();
    expect(r3.log_index).toBeGreaterThan(logIndex);

    const calls = await getLLMMockServer!().getCalls();
    expect(calls).toHaveLength(2);
  });
});

// ============================================================================
// Suite 5: Chat Queue E2E (chatQueueE2E.test.ts)
// ============================================================================

  describe('Chat Queue E2E', () => {
  const { getStore: getQueueStore } = setupTestDb(QUEUE_TEST_DB_PATH);

  beforeEach(() => {
    jest.clearAllMocks();
    sharedLLMMockFetch.mockClear();
  });

  it('queueMessage adds to queue without changing executionState', () => {
    const store = getQueueStore();
    const conversationID = -100;

    store.dispatch(createConversation({
      conversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'initial'
    }));

    let conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.executionState).toBe('WAITING');

    store.dispatch(queueMessage({ conversationID, message: 'follow up 1' }));

    conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.queuedMessages).toHaveLength(1);
    expect(conv.queuedMessages![0].message).toBe('follow up 1');
    expect(conv.executionState).toBe('WAITING');

    store.dispatch(queueMessage({ conversationID, message: 'follow up 2' }));

    conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.queuedMessages).toHaveLength(2);
    expect(conv.queuedMessages![1].message).toBe('follow up 2');
  });

  it('clearQueuedMessages empties the queue', () => {
    const store = getQueueStore();
    const conversationID = -101;

    store.dispatch(createConversation({ conversationID, agent: 'MultiToolAgent', agent_args: {}, message: 'initial' }));

    store.dispatch(queueMessage({ conversationID, message: 'msg1' }));
    store.dispatch(queueMessage({ conversationID, message: 'msg2' }));

    let conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.queuedMessages).toHaveLength(2);

    store.dispatch(clearQueuedMessages({ conversationID }));

    conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.queuedMessages).toHaveLength(0);
  });

  it('flushQueuedMessages moves queue to messages as a combined user message', () => {
    const store = getQueueStore();
    const conversationID = -102;

    store.dispatch(createConversation({ conversationID, agent: 'MultiToolAgent', agent_args: {}, message: 'initial' }));

    store.dispatch(queueMessage({ conversationID, message: 'part 1' }));
    store.dispatch(queueMessage({ conversationID, message: 'part 2' }));

    store.dispatch(flushQueuedMessages({ conversationID }));

    const conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.queuedMessages).toHaveLength(0);

    const userMessages = conv.messages.filter(m => m.role === 'user');
    expect(userMessages).toHaveLength(2);
    expect(userMessages[1].content).toBe('part 1\n\npart 2');
  });

  it('interruptChat sets wasInterrupted and preserves queuedMessages', () => {
    const store = getQueueStore();
    const conversationID = -103;

    store.dispatch(createConversation({ conversationID, agent: 'MultiToolAgent', agent_args: {}, message: 'start' }));
    store.dispatch(queueMessage({ conversationID, message: 'queued msg' }));
    store.dispatch(interruptChat({ conversationID }));

    const conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.executionState).toBe('FINISHED');
    expect(conv.wasInterrupted).toBe(true);
    expect(conv.queuedMessages).toHaveLength(1);
    expect(conv.queuedMessages![0].message).toBe('queued msg');
  });

  it('sendMessage clears wasInterrupted flag', () => {
    const store = getQueueStore();
    const conversationID = -104;

    store.dispatch(createConversation({ conversationID, agent: 'MultiToolAgent', agent_args: {}, message: 'start' }));
    store.dispatch(interruptChat({ conversationID }));

    let conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.wasInterrupted).toBe(true);

    store.dispatch(sendMessage({ conversationID, message: 'new message' }));

    conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.wasInterrupted).toBe(false);
    expect(conv.executionState).toBe('WAITING');
  });

  it('queued messages auto-send when conversation finishes (end-of-turn)', async () => {
    const store = getQueueStore();
    const conversationID = -200;

    store.dispatch(setAllowChatQueue(true));

    store.dispatch(createConversation({
      conversationID,
      agent: 'MultiToolAgent',
      agent_args: { goal: 'Testing queue' },
      message: 'initial question'
    }));

    let realConversationID = conversationID;
    await waitFor(() => {
      const tempConv = selectConversation(store.getState() as RootState, conversationID);
      if (tempConv?.forkedConversationID) {
        realConversationID = tempConv.forkedConversationID;
      }
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED' || c?.executionState === 'EXECUTING';
    }, 15000);

    let conv = selectConversation(store.getState() as RootState, realConversationID)!;
    if (conv.executionState === 'EXECUTING') {
      for (const pending of conv.pending_tool_calls) {
        if (!pending.result) {
          store.dispatch(completeToolCall({
            conversationID: realConversationID,
            tool_call_id: pending.toolCall.id,
            result: { role: 'tool', tool_call_id: pending.toolCall.id, content: 'Tool completed', created_at: new Date().toISOString() }
          }));
        }
      }
    }

    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, realConversationID);
      if (!c) return false;
      return c.executionState === 'FINISHED';
    }, 15000);

    store.dispatch(queueMessage({ conversationID: realConversationID, message: 'also summarize' }));

    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, realConversationID);
      if (!c) return false;
      return c.executionState === 'FINISHED' && (!c.queuedMessages || c.queuedMessages.length === 0);
    }, 15000);

    conv = selectConversation(store.getState() as RootState, realConversationID)!;
    const userMessages = conv.messages.filter(m => m.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
    const queuedUserMsg = userMessages.find(m => m.content === 'also summarize');
    expect(queuedUserMsg).toBeDefined();
  }, 30000);
});

// ============================================================================
// Suite 6: Edit and Fork E2E (editAndFork.test.ts)
// ============================================================================

async function loadConversationIntoRedux(
  store: ReturnType<typeof setupTestStore>,
  conversationID: number,
  logIndex: number
): Promise<void> {
  const { getOrCreateConversation } = await import('@/lib/conversations');

  const mockUser: any = {
    userId: 1,
    email: 'test@example.com',
    role: 'admin',
    mode: 'org',
    home_folder: '/org',
    tokenVersion: 1,
  };

  const { content } = await getOrCreateConversation(conversationID, mockUser);
  const messages = parseLogToMessages((content as ConversationFile).log);

  store.dispatch(loadConversation({
    conversation: {
      _id: crypto.randomUUID(),
      conversationID,
      log_index: logIndex,
      messages,
      executionState: 'FINISHED',
      pending_tool_calls: [],
      streamedCompletedToolCalls: [],
      streamedThinking: '',
      agent: 'AnalystAgent',
      agent_args: {},
    },
  }));
}

async function runTurnViaAPI(opts: {
  conversationID?: number;
  log_index?: number;
  message: string;
  llmAnswer: string;
  getLLMMockServer: (() => { configure: (cfg: any) => Promise<void> }) | undefined;
}): Promise<{ conversationID: number; log_index: number }> {
  const { message, llmAnswer, getLLMMockServer: getLLMServer } = opts;

  await getLLMServer!().configure({
    response: {
      content: llmAnswer,
      role: 'assistant',
      tool_calls: [],
      finish_reason: 'stop',
    },
    usage: { total_tokens: 40, prompt_tokens: 30, completion_tokens: 10 },
  });

  const response = await chatPostHandler(createNextRequest({
    conversationID: opts.conversationID,
    log_index: opts.log_index,
    user_message: message,
    agent: 'AnalystAgent',
    agent_args: { goal: message },
  }));
  const r = await response.json();
  if (r.error) throw new Error(`Turn failed: ${r.error}`);
  return { conversationID: r.conversationID, log_index: r.log_index };
}

  describe('Edit and Fork E2E', () => {
  const { getStore: getEditForkStore } = setupTestDb(EDIT_FORK_TEST_DB_PATH);

  let store: ReturnType<typeof setupTestStore>;

  beforeEach(async () => {
    sharedLLMMockFetch.mockClear();
    await getLLMMockServer!().reset();
    store = getEditForkStore();
  });

  it('forks at the right log_index and the forked conversation contains only the edited message', async () => {
    const turn1 = await runTurnViaAPI({
      message: 'First message',
      llmAnswer: 'Answer to first message',
      getLLMMockServer: getLLMMockServer,
    });
    const { conversationID } = turn1;
    const logIndexAfterTurn1 = turn1.log_index;

    const turn2 = await runTurnViaAPI({
      conversationID,
      log_index: logIndexAfterTurn1,
      message: 'Second message',
      llmAnswer: 'Answer to second message',
      getLLMMockServer: getLLMMockServer,
    });
    expect(turn2.log_index).toBeGreaterThan(logIndexAfterTurn1);

    await loadConversationIntoRedux(store, conversationID, turn2.log_index);

    const convLoaded = selectConversation(store.getState() as RootState, conversationID)!;
    const userMsgs = convLoaded.messages.filter(m => m.role === 'user');
    expect(userMsgs).toHaveLength(2);
    expect((userMsgs[0] as any).logIndex).toBeDefined();
    expect((userMsgs[1] as any).logIndex).toBe(logIndexAfterTurn1);

    await getLLMMockServer!().configure({
      response: { content: 'Answer to edited second message', role: 'assistant', tool_calls: [], finish_reason: 'stop' },
      usage: { total_tokens: 40, prompt_tokens: 30, completion_tokens: 10 },
    });

    store.dispatch(editAndForkMessage({
      conversationID,
      logIndex: logIndexAfterTurn1,
      message: 'Edited second message',
    }));

    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, conversationID);
      return !!c?.forkedConversationID;
    }, 15000);

    const forkedID = selectConversation(store.getState() as RootState, conversationID)!.forkedConversationID!;
    expect(forkedID).not.toBe(conversationID);

    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, forkedID);
      return c?.executionState === 'FINISHED';
    }, 15000);

    const forkedConv = selectConversation(store.getState() as RootState, forkedID)!;
    expect(forkedConv.executionState).toBe('FINISHED');

    const forkedUserMsgs = forkedConv.messages.filter(m => m.role === 'user');
    expect(forkedUserMsgs).toHaveLength(2);
    expect(forkedUserMsgs[0].content).toBe('First message');
    expect(forkedUserMsgs[1].content).toBe('Edited second message');
  });

  it('editAndForkMessage from logIndex=0 produces a conversation with only the new first message', async () => {
    const turn1 = await runTurnViaAPI({
      message: 'Original first',
      llmAnswer: 'Answer to original first',
      getLLMMockServer: getLLMMockServer,
    });
    const { conversationID } = turn1;
    const logIndexAfterTurn1 = turn1.log_index;

    const turn2 = await runTurnViaAPI({
      conversationID,
      log_index: logIndexAfterTurn1,
      message: 'Second turn',
      llmAnswer: 'Answer to second turn',
      getLLMMockServer: getLLMMockServer,
    });
    expect(turn2.log_index).toBeGreaterThan(logIndexAfterTurn1);

    await loadConversationIntoRedux(store, conversationID, turn2.log_index);

    const convLoaded = selectConversation(store.getState() as RootState, conversationID)!;
    const turn1UserMsg = convLoaded.messages.find(m => m.role === 'user') as any;
    expect(turn1UserMsg.logIndex).toBe(0);

    await getLLMMockServer!().configure({
      response: { content: 'Answer to brand new start', role: 'assistant', tool_calls: [], finish_reason: 'stop' },
      usage: { total_tokens: 40, prompt_tokens: 30, completion_tokens: 10 },
    });

    store.dispatch(editAndForkMessage({
      conversationID,
      logIndex: 0,
      message: 'Brand new start',
    }));

    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, conversationID);
      return !!c?.forkedConversationID;
    }, 15000);

    const forkedID = selectConversation(store.getState() as RootState, conversationID)!.forkedConversationID!;
    expect(forkedID).not.toBe(conversationID);

    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, forkedID);
      return c?.executionState === 'FINISHED';
    }, 15000);

    const forkedConv = selectConversation(store.getState() as RootState, forkedID)!;
    expect(forkedConv.executionState).toBe('FINISHED');

    const forkedUserMsgs = forkedConv.messages.filter(m => m.role === 'user');
    expect(forkedUserMsgs).toHaveLength(1);
    expect(forkedUserMsgs[0].content).toBe('Brand new start');
  });
  }); // end Edit and Fork E2E

}); // end LLM-Mocked Agent Suites
