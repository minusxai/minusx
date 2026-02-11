/**
 * End-to-end integration test for Next.js /api/chat endpoint
 *
 * Tests the API handler directly without Redux layer.
 * Self-contained: Starts own Python backend on dynamically allocated port.
 *
 * Run: npm test -- route.test.ts
 */

import { POST } from '../route';
import {
  initTestDatabase,
  cleanupTestDatabase,
  createNextRequest,
  getTestDbPath
} from '@/store/__tests__/test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';

// Database-specific mock (test name must match)
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_route.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

const TEST_DB_PATH = getTestDbPath('route');

describe('Chat API - Handler Tests', () => {
  const { getPythonPort } = withPythonBackend();
  const mockFetch = setupMockFetch({
    getPythonPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: POST
      }
    ]
  });

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
    const response1 = await POST(createNextRequest({
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
    const response2 = await POST(createNextRequest({
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
    const response3 = await POST(createNextRequest({
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
    const response4 = await POST(createNextRequest({
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
    const response5 = await POST(createNextRequest({
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

    const response = await POST(createNextRequest({
      user_message: 'Test message',
      agent: 'DefaultAgent',
      agent_args: {}
    }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('No company ID found for user');
  });
});
