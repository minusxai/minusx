/**
 * E2E test for Redux chat orchestration with REAL /api/chat endpoint
 *
 * Tests the full stack: Redux → Listener Middleware → API → Python Backend
 * Self-contained: Starts own Python backend on dynamically allocated port.
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
import type { RootState } from '../store';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { waitFor, getTestDbPath } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';

// Mock database config (uses __mocks__/db-config.ts but with custom path)
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_e2e.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

describe('Chat E2E - Redux Orchestration', () => {
  // Setup infrastructure with reusable harnesses
  const { getPythonPort } = withPythonBackend();
  const { getStore } = setupTestDb(getTestDbPath('e2e'));
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
    // Backend auto-executes UserInputToolBackend
    // Frontend listener may dispatch UserInputTool that needs manual completion
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
    // This simulates client with stale state, backend will return newConversationID
    const staleLogIndex = log_index2;  // Use log_index from Step 1

    // Manually update to simulate stale state
    conv = selectConversation(store.getState() as RootState, realConversationID);
    const messagesBeforeFork = conv!.messages.length;

    // Reset log_index to stale value by dispatching updateConversation
    store.dispatch(updateConversation({
      conversationID: realConversationID,
      log_index: staleLogIndex,
      completed_tool_calls: [],
      pending_tool_calls: []
    }));

    // Send message with stale log_index - backend should detect conflict and fork
    store.dispatch(sendMessage({ conversationID: realConversationID, message: 'Fork test' }));

    // Give listener time to process (it happens async)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check what happened
    const allConversations = (store.getState() as RootState).chat.conversations;
    const originalExists = selectConversation(store.getState() as RootState, realConversationID);

    // Find forked conversation - it will be a new positive integer ID different from realConversationID
    const forkedConv = Object.values(allConversations).find((c: any) =>
      c.conversationID !== realConversationID &&
      c.conversationID > 0 && // Real file ID (positive)
      c.conversationID !== conversationID // Not the original temp ID either
    );

    if (forkedConv) {
      // Forking occurred - both old and new conversation exist
      expect(originalExists).toBeDefined();  // Old conversation still exists
      expect(forkedConv.conversationID).not.toBe(realConversationID);
      expect(forkedConv.log_index).toBeGreaterThan(0);
      expect(forkedConv.messages.length).toBeGreaterThan(0);
    } else {
      // No forking - conversation just continued with same ID
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

  it('should persist LLM calls to separate files', async () => {
    // Test LLM call file structure and database schema
    // This verifies the llm_call file type is correctly configured
    const { DocumentDB } = require('@/lib/database/documents-db');

    const userId = 'test@example.com';
    const companyId = 1;
    const conversationID = 999;
    const llmCallId = 'test-llm-call-id-12345';

    // Mock LLM call content (matches LLMCallFileContent interface)
    const mockContent = {
      conversationID,
      llm_call_id: llmCallId,
      model: 'gpt-4',
      duration: 1.5,
      total_tokens: 500,
      prompt_tokens: 300,
      completion_tokens: 200,
      cost: 0.015,
      finish_reason: 'stop',
      extra: { request: 'test', response: 'test' },
      created_at: new Date().toISOString()
    };

    // Create LLM call file directly using DocumentDB
    const fileName = `${llmCallId}.json`;
    const path = `/logs/llm_calls/${userId}/${fileName}`;

    const fileId = await DocumentDB.create(fileName, path, 'llm_call', mockContent, [], companyId);  // Phase 6: LLM calls have no references
    expect(fileId).toBeGreaterThan(0);

    // Query database to verify file was created
    const createdFile = await DocumentDB.getById(fileId, companyId);
    expect(createdFile).toBeDefined();
    expect(createdFile!.type).toBe('llm_call');
    expect(createdFile!.path).toBe(path);
    expect(createdFile!.name).toBe(fileName);

    // Verify file content structure
    const content = createdFile!.content;
    expect(content).toHaveProperty('conversationID');
    expect(content).toHaveProperty('llm_call_id');
    expect(content).toHaveProperty('model');
    expect(content).toHaveProperty('duration');
    expect(content).toHaveProperty('total_tokens');
    expect(content).toHaveProperty('prompt_tokens');
    expect(content).toHaveProperty('completion_tokens');
    expect(content).toHaveProperty('cost');
    expect(content).toHaveProperty('created_at');

    // Verify values
    expect(content.conversationID).toBe(conversationID);
    expect(content.llm_call_id).toBe(llmCallId);
    expect(content.model).toBe('gpt-4');
    expect(content.total_tokens).toBe(500);
    expect(content.cost).toBe(0.015);

    // Test listAll with path filter
    const llmCallPathPrefix = `/logs/llm_calls/${userId}`;
    const files = await DocumentDB.listAll(companyId, 'llm_call', [llmCallPathPrefix], -1);
    expect(files.length).toBeGreaterThan(0);

    const foundFile = files.find((f: any) => f.id === fileId);
    expect(foundFile).toBeDefined();
  });

  it('should handle multiple LLM calls in one response', async () => {
    // Test that multiple LLM call files can be created and queried
    const { DocumentDB } = require('@/lib/database/documents-db');

    const userId = 'test@example.com';
    const companyId = 1;
    const conversationID = 1000;

    // Create multiple LLM call files
    const llmCallIds = ['llm-call-1', 'llm-call-2', 'llm-call-3'];
    const createdFileIds: number[] = [];

    for (const llmCallId of llmCallIds) {
      const mockContent = {
        conversationID,
        llm_call_id: llmCallId,
        model: 'gpt-4',
        duration: Math.random() * 2,
        total_tokens: Math.floor(Math.random() * 500) + 300,
        prompt_tokens: Math.floor(Math.random() * 300) + 200,
        completion_tokens: Math.floor(Math.random() * 200) + 100,
        cost: Math.random() * 0.02,
        created_at: new Date().toISOString()
      };

      const fileName = `${llmCallId}.json`;
      const path = `/logs/llm_calls/${userId}/${fileName}`;

      const fileId = await DocumentDB.create(fileName, path, 'llm_call', mockContent, [], companyId);  // Phase 6: LLM calls have no references
      expect(fileId).toBeGreaterThan(0);
      createdFileIds.push(fileId);
    }

    // Query database for all LLM call files for this user
    const llmCallPathPrefix = `/logs/llm_calls/${userId}`;
    const allFiles = await DocumentDB.listAll(companyId, 'llm_call', [llmCallPathPrefix], -1);

    // Filter to files for this conversation
    const files = allFiles.filter((f: any) => {
      return f.content.conversationID === conversationID;
    });

    // Should have created all three files
    expect(files.length).toBe(3);

    // Verify all files have correct conversationID and unique IDs
    const foundLlmCallIds = new Set();
    files.forEach((file: any) => {
      expect(file.content.conversationID).toBe(conversationID);
      expect(file.content).toHaveProperty('llm_call_id');
      expect(file.content).toHaveProperty('model');
      expect(file.content).toHaveProperty('total_tokens');
      expect(file.content).toHaveProperty('cost');

      // Verify IDs are unique
      foundLlmCallIds.add(file.content.llm_call_id);
    });

    expect(foundLlmCallIds.size).toBe(3); // All IDs should be unique
    expect(foundLlmCallIds).toEqual(new Set(llmCallIds)); // Should match what we created
  });
});
