/**
 * E2E test for nested tool calls (backend tools spawning frontend tools)
 *
 * Tests ExecuteSQLQuery with foreground=true delegation to ExecuteSQLQueryForeground
 * Uses LLM mocking to control AnalystAgent's tool calls.
 *
 * Run: npm test -- store/__tests__/chatNestedTools.test.ts
 */

import {
  createConversation,
  sendMessage,
  selectConversation,
  setUserInputResult
} from '../chatSlice';
import type { RootState } from '../store';
import { setAskForConfirmation } from '../uiSlice';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { waitFor, getTestDbPath } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch, commonInterceptors } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';

// Database-specific mock (test name must match)
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_nested_tools.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

describe('Nested Tool Calls - ExecuteSQLQuery with Foreground', () => {
  // Setup infrastructure with reusable harnesses
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
  const { getStore } = setupTestDb(getTestDbPath('nested_tools'), { withTestConnection: true });
  const mockFetch = setupMockFetch({
    getPythonPort,
    getLLMMockPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler
      }
    ],
    additionalInterceptors: [
      commonInterceptors.mockQuerySimple,
      commonInterceptors.mockSchemaSimple
    ]
  });

  beforeEach(async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();
    mockFetch.mockClear();
  });

  it('should spawn ExecuteSQLQueryForeground when ExecuteSQLQuery has foreground=true', async () => {
    const store = getStore();
    const mockServer = getLLMMockServer!();
    const conversationID = -100;

    // Configure mock LLM to return ExecuteSQLQuery with foreground=true, then finish
    await mockServer.configure([
      // Turn 1: Agent calls ExecuteSQLQuery with foreground=true
      {
        response: {
          content: "I'll execute the query and update the UI.",
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_execute_sql',
              type: 'function',
              function: {
                name: 'ExecuteSQLQuery',
                arguments: JSON.stringify({
                  query: 'SELECT 1 as test',
                  connection_id: 'test_connection',
                  foreground: true,
                  vizSettings: JSON.stringify({ type: 'table' }),
                  file_id: 1
                })
              }
            }
          ],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 100, prompt_tokens: 50, completion_tokens: 50 }
      },
      // Turn 2: After ExecuteSQLQuery completes, agent finishes
      {
        response: {
          content: "Query executed and UI updated successfully.",
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop'
        },
        usage: { total_tokens: 120, prompt_tokens: 80, completion_tokens: 40 }
      }
    ]);

    // Create conversation with AnalystAgent
    store.dispatch(createConversation({
      conversationID,
      agent: 'AnalystAgent',
      agent_args: {
        goal: 'Show me a chart of sales by region',
        connection_id: 'test_connection',
        app_state: {
          file_id: 1,
          pageType: 'question'
        }
      }
    }));

    store.dispatch(sendMessage({
      conversationID,
      message: 'Show me a chart of sales by region'
    }));

    let realConversationID = conversationID;

    // Wait for conversation to finish (frontend tools execute automatically via middleware)
    await waitFor(() => {
      const tempConv = selectConversation(store.getState() as RootState, conversationID);
      if (tempConv?.forkedConversationID) {
        realConversationID = tempConv.forkedConversationID;
      }
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED';
    }, 10000);

    const conv = selectConversation(store.getState() as RootState, realConversationID);
    if (!conv) {
      throw new Error('Conversation not found after completion');
    }

    // Verify parent tool (ExecuteSQLQuery) completed with child results
    const parentCompletion = conv.messages.find((m: any) =>
      m.role === 'tool' && m.function?.name === 'ExecuteSQLQuery'
    );

    if (!parentCompletion) {
      throw new Error('Parent tool completion not found');
    }

    expect(parentCompletion).toBeDefined();
    if (parentCompletion?.role === 'tool') {
      const parentContent = typeof parentCompletion.content === 'string'
        ? JSON.parse(parentCompletion.content)
        : parentCompletion.content;
      expect(parentContent.message || parentContent).toContain('UI updated');
    }

    expect(conv.executionState).toBe('FINISHED');
    expect(conv.pending_tool_calls.length).toBe(0);
  }, 45000);

  it('should execute ExecuteSQLQuery in background mode when foreground=false', async () => {
    const store = getStore();
    const mockServer = getLLMMockServer!();
    const conversationID = -101;

    // Configure mock LLM to return ExecuteSQLQuery with foreground=false, then finish
    await mockServer.configure([
      // Turn 1: Agent calls ExecuteSQLQuery with foreground=false
      {
        response: {
          content: "I'll execute the query in the background.",
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_execute_sql_bg',
              type: 'function',
              function: {
                name: 'ExecuteSQLQuery',
                arguments: JSON.stringify({
                  query: 'SELECT 1 as test',
                  connection_id: 'test_connection',
                  foreground: false  // Background mode
                })
              }
            }
          ],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 100, prompt_tokens: 50, completion_tokens: 50 }
      },
      // Turn 2: After ExecuteSQLQuery completes, agent finishes
      {
        response: {
          content: "Query executed successfully.",
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop'
        },
        usage: { total_tokens: 120, prompt_tokens: 80, completion_tokens: 40 }
      }
    ]);

    // Create conversation with AnalystAgent
    store.dispatch(createConversation({
      conversationID,
      agent: 'AnalystAgent',
      agent_args: {
        goal: 'Execute SQL query in background',
        connection_id: 'test_connection'
      }
    }));

    store.dispatch(sendMessage({
      conversationID,
      message: 'Execute SQL query in background'
    }));

    let realConversationID = conversationID;

    // Wait for execution to finish (background mode completes automatically)
    await waitFor(() => {
      const tempConv = selectConversation(store.getState() as RootState, conversationID);
      if (tempConv?.forkedConversationID) {
        realConversationID = tempConv.forkedConversationID;
      }
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED';
    }, 10000);

    const conv = selectConversation(store.getState() as RootState, realConversationID);
    if (!conv) {
      throw new Error('Conversation not found');
    }

    // Verify NO ExecuteSQLQueryForeground was spawned (background mode doesn't spawn frontend tools)
    const foregroundTool = conv.pending_tool_calls.find((p: any) =>
      p.toolCall.function?.name === 'ExecuteSQLQueryForeground'
    );

    expect(foregroundTool).toBeUndefined();
    expect(conv.executionState).toBe('FINISHED');

    // Verify ExecuteSQLQuery completed in background
    const executeSQLCompletion = conv.messages.find((m: any) =>
      m.role === 'tool' && m.function?.name === 'ExecuteSQLQuery'
    );

    expect(executeSQLCompletion).toBeDefined();
  }, 45000);

  it('should handle user input confirmation in ExecuteSQLQueryForeground', async () => {
    const store = getStore();
    const mockServer = getLLMMockServer!();
    const conversationID = -300;

    // Enable askForConfirmation setting
    store.dispatch(setAskForConfirmation(true));

    // Configure LLM to call ExecuteSQLQuery with foreground=true (which spawns ExecuteSQLQueryForeground)
    await mockServer.configure([
      {
        response: {
          content: "I'll execute the query",
          role: 'assistant',
          tool_calls: [{
            id: 'call_exec_sql',
            type: 'function',
            function: {
              name: 'ExecuteSQLQuery',
              arguments: JSON.stringify({
                query: 'SELECT * FROM test_table',
                connection_id: 'test_connection',
                foreground: true,
                vizSettings: JSON.stringify({ type: 'table' }),
                file_id: 1
              })
            }
          }],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 100, prompt_tokens: 50, completion_tokens: 50 }
      },
      // Second turn after user confirms and tool completes
      {
        response: {
          content: "Query executed successfully",
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop'
        },
        usage: { total_tokens: 120, prompt_tokens: 80, completion_tokens: 40 }
      }
    ]);

    // Create conversation and send message
    store.dispatch(createConversation({
      conversationID,
      agent: 'AnalystAgent',
      agent_args: {
        goal: 'Execute a SQL query',
        connection_id: 'test_connection',
        app_state: {
          fileId: 1,
          pageType: 'question'
        }
      }
    }));

    store.dispatch(sendMessage({
      conversationID,
      message: 'Run the query'
    }));

    // Track the real conversation ID (may fork)
    let realConversationID = conversationID;

    // Wait for user input to be requested (ExecuteSQLQueryForeground spawned by ExecuteSQLQuery)
    await waitFor(() => {
      const tempConv = selectConversation(store.getState() as RootState, conversationID);
      if (tempConv?.forkedConversationID) {
        realConversationID = tempConv.forkedConversationID;
      }
      const conv = selectConversation(store.getState() as RootState, realConversationID);
      const pendingTool = conv?.pending_tool_calls.find(
        (p: any) => p.toolCall.function.name === 'ExecuteSQLQueryForeground'
      );
      return !!(pendingTool?.userInputs && pendingTool.userInputs.length > 0);
    }, 5000);

    // Verify user input request was added
    let conv = selectConversation(store.getState() as RootState, realConversationID);
    const pendingTool = conv?.pending_tool_calls.find(
      (p: any) => p.toolCall.function.name === 'ExecuteSQLQueryForeground'
    );

    expect(pendingTool).toBeDefined();
    expect(pendingTool?.userInputs).toBeDefined();
    expect(pendingTool?.userInputs?.[0]).toMatchObject({
      props: {
        type: 'confirmation',
        title: 'Edit this question?',
        message: 'Do you want to update the question with this query?',
        confirmText: 'Yes',
        cancelText: 'No'
      },
      result: undefined
    });

    // User confirms
    store.dispatch(setUserInputResult({
      conversationID: realConversationID,
      tool_call_id: pendingTool!.toolCall.id,
      userInputId: pendingTool!.userInputs![0].id,
      result: true
    }));

    // Wait for execution to complete
    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED';
    }, 10000);

    // Verify final state
    conv = selectConversation(store.getState() as RootState, realConversationID);
    expect(conv?.executionState).toBe('FINISHED');
    expect(conv?.pending_tool_calls.length).toBe(0);

    // Verify the tool completed in messages
    const toolCompletion = conv?.messages.find((m: any) =>
      m.role === 'tool' && m.tool_call_id === 'call_exec_sql'
    );
    expect(toolCompletion).toBeDefined();

    // Reset setting for other tests
    store.dispatch(setAskForConfirmation(false));
  }, 45000);
});
