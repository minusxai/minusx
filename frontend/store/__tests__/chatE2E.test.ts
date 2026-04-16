/**
 * Chat API E2E Tests
 *
 * Combined test file covering two layers:
 *   1. Chat API Handler Tests — tests the /api/chat route handler directly
 *   2. Chat E2E Redux Orchestration — tests the full Redux → Listener → API → Python stack
 *
 * Both suites share a single Python backend instance to reduce CI resource pressure.
 *
 * Run: npm test -- store/__tests__/chatE2E.test.ts
 */

import {
  createConversation,
  sendMessage,
  selectConversation,
  completeToolCall,
  updateConversation
} from '../chatSlice';
import { setAllowChatQueue } from '../uiSlice';
import type { RootState } from '../store';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { waitFor, getTestDbPath, initTestDatabase, cleanupTestDatabase, createNextRequest } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';

// Unified test database path for all suites in this file
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_chat_api.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

const TEST_DB_PATH = getTestDbPath('chat_api');

// ============================================================================
// Outer describe: shared Python backend for all suites
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
    beforeEach(async () => {
      // Reset adapter to ensure fresh connection
      const { resetAdapter } = await import('@/lib/database/adapter/factory');
      await resetAdapter();

      await initTestDatabase(TEST_DB_PATH);
      jest.clearAllMocks();
      mockFetch.mockClear();
    });

    afterAll(async () => {
      await cleanupTestDatabase(TEST_DB_PATH);
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
      expect(data.error).toBe('No company ID found for user');
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
      store.dispatch(setAllowChatQueue(true));
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
      store.dispatch(setAllowChatQueue(true));
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
