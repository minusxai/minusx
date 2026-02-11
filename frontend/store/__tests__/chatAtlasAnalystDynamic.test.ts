/**
 * E2E test for AtlasAnalystAgent with Dynamic LLM Mocking
 *
 * This test uses a dynamic LLM mock server that allows:
 * - Request validation (assert on messages, tools, settings)
 * - Dynamic response configuration per conversation turn
 * - Full observability of LLM calls
 *
 * Architecture:
 * 1. LLM Mock Server (dynamic port) - Receives Python LLM calls, returns configured responses
 * 2. Python Test Server (dynamic port) - Real orchestrator, mocked LLM → calls mock server
 * 3. Next.js API Handler (mocked) - Routes to Python test server
 * 4. Redux Test - Configures mock, dispatches actions, verifies state
 *
 * Prerequisites:
 *   1. Install dependencies: npm install express @types/express
 *   2. Run test: npm test -- store/__tests__/chatAtlasAnalystDynamic.test.ts
 *
 * Note: Test automatically starts/stops mock server and Python test server.
 */

import {
  createConversation,
  sendMessage,
  selectConversation
} from '../chatSlice';
import type { RootState } from '../store';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { waitFor, getTestDbPath } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch, commonInterceptors } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';

// Database-specific mock (test name must match)
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_atlas_analyst_dyn.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

describe('Atlas Agent - E2E with Dynamic LLM Mocking', () => {
  // Setup infrastructure with reusable harnesses
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
  const { getStore } = setupTestDb(getTestDbPath('atlas_analyst_dyn'), { withTestConnection: true });
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
      commonInterceptors.mockQuerySales,
      commonInterceptors.mockSchemaSales
    ]
  });

  beforeEach(async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();
    mockFetch.mockClear();
  });

  it('should complete conversation with immediate response (no tools)', async () => {
    const store = getStore();
    const mockServer = getLLMMockServer!();
    const conversationID = -100; // Temp conversation ID (negative)

    // Configure mock to return a simple completion response
    await mockServer.configure({
      response: {
        content: "Here's the sales data you requested.",
        role: 'assistant',
        tool_calls: [],  // No tools - just complete immediately
        finish_reason: 'stop'
      },
      usage: { total_tokens: 150, prompt_tokens: 100, completion_tokens: 50 }
    });

    // Create conversation and send message
    store.dispatch(createConversation({
      conversationID,
      agent: 'AtlasAnalystAgent',
      agent_args: {
        goal: 'Show me a chart of sales by region',
        connection_id: 'test_connection'
      }
    }));

    store.dispatch(sendMessage({ conversationID, message: 'Show me a chart of sales by region' }));

    // Wait for conversation to finish (mock returns stop finish_reason)
    // Track real conversation ID in case temp conversation forks
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

    // Verify mock was called
    const calls = await mockServer.getCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);
  }, 45000);

  it('should handle multi-turn conversation with tool calls and history', async () => {
    const store = getStore();
    const mockServer = getLLMMockServer!();
    const conversationID = -200; // Temp conversation ID (negative)

    // Configure BOTH LLM responses upfront (auto-execution loop will use them sequentially)
    await mockServer.configure([
      // Turn 1: Agent searches schema
      {
        validateRequest: (req) => {
          // Helper to extract text from content (string or content_blocks array)
          const getText = (content: any): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
              return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n\n');
            }
            return '';
          };

          // Validate first call has system message and user message
          console.log('\n=== Turn 1 History ===');
          req.messages.forEach((m: any, i: number) => {
            const contentPreview = getText(m.content).substring(0, 50) || m.tool_call_id || '[tool_calls]';
            console.log(`${i}: ${m.role} - ${contentPreview}`);
          });
          console.log('======================\n');

          expect(req.messages.length).toBe(2); // system + user
          expect(req.messages[0].role).toBe('system');
          expect(req.messages[1].role).toBe('user');
          expect(getText(req.messages[1].content)).toContain('sales by region');

          // Validate tools are provided
          expect(req.tools).toBeDefined();
          expect(req.tools!.length).toBeGreaterThan(0);
          const toolNames = req.tools!.map((t: any) => t.function.name);
          expect(toolNames).toContain('SearchDBSchema');
          expect(toolNames).toContain('ExecuteSQLQuery');

          return true;
        },
        response: {
          content: "I'll search the schema to find sales data.",
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_001',
              type: 'function',
              function: {
                name: 'SearchDBSchema',
                arguments: JSON.stringify({
                  query: 'SalesTerritory',
                  connection_id: 'test_connection'
                })
              }
            }
          ],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 100, prompt_tokens: 50, completion_tokens: 50 }
      },
      // Turn 2: After tool execution, agent completes
      {
        validateRequest: (req) => {
          // Helper to extract text from content (string or content_blocks array)
          const getText = (content: any): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
              return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n\n');
            }
            return '';
          };

          // Validate second call has tool result message
          console.log('\n=== Turn 2 History ===');
          req.messages.forEach((m: any, i: number) => {
            const contentPreview = getText(m.content).substring(0, 50) || m.tool_call_id || '[tool_calls]';
            console.log(`${i}: ${m.role} - ${contentPreview}`);
          });
          console.log('======================\n');

          expect(req.messages.length).toBe(4); // system + user + assistant + tool
          expect(req.messages[0].role).toBe('system');
          expect(req.messages[1].role).toBe('user');
          expect(req.messages[2].role).toBe('assistant');
          expect(req.messages[3].role).toBe('tool');
          expect(req.messages[3].tool_call_id).toBe('call_001');

          // Validate tool result contains schema info
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
      // Turn 3: User sends follow-up message, verify full history
      {
        validateRequest: (req) => {
          // Helper to extract text from content (string or content_blocks array)
          const getText = (content: any): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
              return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n\n');
            }
            return '';
          };

          // Validate full conversation history is preserved
          console.log('\n=== Turn 3 History ===');
          req.messages.forEach((m: any, i: number) => {
            const contentPreview = getText(m.content).substring(0, 50) || m.tool_call_id || '[tool_calls]';
            console.log(`${i}: ${m.role} - ${contentPreview}`);
          });
          console.log('======================\n');

          // History: system + [user1 + assistant1 + tool1 + assistant2] + user2
          expect(req.messages.length).toBe(6);
          expect(req.messages[0].role).toBe('system');

          // Previous exchange (from history):
          expect(req.messages[1].role).toBe('user'); // user1
          expect(req.messages[2].role).toBe('assistant'); // assistant1 with tool call
          expect(req.messages[3].role).toBe('tool'); // tool1 result
          expect(req.messages[4].role).toBe('assistant'); // assistant2 final response

          // Current turn:
          expect(req.messages[5].role).toBe('user'); // user2

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

    // Create conversation and send message
    store.dispatch(createConversation({
      conversationID,
      agent: 'AtlasAnalystAgent',
      agent_args: {
        goal: 'Show me a chart of sales by region',
        connection_id: 'test_connection'
      }
    }));

    store.dispatch(sendMessage({ conversationID, message: 'Show me a chart of sales by region' }));

    // Wait for first exchange to finish (auto-execution will handle both turns)
    // Track real conversation ID in case temp conversation forks
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

    // Verify tools were executed and tracked in messages
    expect(conv!.messages?.length).toBe(4); // user + 3 tool results
    const toolMessages = conv!.messages?.filter((m: any) => m.role === 'tool') || [];
    expect(toolMessages.length).toBe(3);

    // Verify SearchDBSchema was executed
    const schemaSearchTool = toolMessages.find((m: any) => m.function?.name === 'SearchDBSchema');
    expect(schemaSearchTool).toBeDefined();

    // Send follow-up message to test history preservation (use real conversation ID)
    store.dispatch(sendMessage({ conversationID: realConversationID, message: 'What about Northwest region?' }));

    // Wait for second message to complete (check real conversation ID)
    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED' && (c?.messages?.length || 0) === 6;
    }, 45000);

    conv = selectConversation(store.getState() as RootState, realConversationID);
    expect(conv!.executionState).toBe('FINISHED');
    expect(conv!.messages?.length).toBe(6); // user1 + 3 tools + user2 + assistant

    // Verify all 3 LLM calls were made
    const calls = await mockServer.getCalls();
    expect(calls.length).toBe(3);
  }, 45000);
});
