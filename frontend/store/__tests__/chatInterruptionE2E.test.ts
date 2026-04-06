/**
 * Chat Interruption & Error Recovery E2E Tests
 *
 * Verifies two correctness guarantees for the chat orchestration system:
 *
 * Test 1 — Frontend tool interrupted by new user message:
 *   When a new user message arrives while a frontend tool (UserInputTool) is
 *   pending, Python marks it `<Interrupted />`. The subsequent LLM call must
 *   receive a history that satisfies LLM API constraints:
 *     - every tool_use block paired with a tool_result
 *     - no consecutive assistant messages
 *     - every tool_result has a preceding tool_call
 *
 * Test 2 — LLM error mid-session, then recovery:
 *   When an LLM call fails (mock queue empty → 500 → Python returns logDiff=[]),
 *   the DB remains at the pre-error state.  The next user message must again
 *   interrupt the still-pending tool and produce a valid LLM history.
 *
 * Both tests use the HTTP API handler directly (no Redux layer) with
 * MultiToolAgent → UserInputTool (direct leaf, no FrontendToolException nesting)
 * then AnalystAgent for the LLM-calling step.
 *
 * Run: npm test -- store/__tests__/chatInterruptionE2E.test.ts
 */

// IMPORTANT: jest.mock calls are hoisted to the top before imports.
// Use require() inside the factory — cannot reference imported modules here.
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_chat_interruption.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

import { POST as chatPostHandler } from '@/app/api/chat/route';
import {
  getTestDbPath,
  initTestDatabase,
  cleanupTestDatabase,
  createNextRequest
} from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';

const TEST_DB_PATH = getTestDbPath('chat_interruption');

// ============================================================================
// Outer describe: shared Python backend + LLM mock for all suites
// ============================================================================

describe('Chat Interruption & Error Recovery E2E', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } =
    withPythonBackend({ withLLMMock: true });

  // Route /api/chat to Next.js handler; let Python + LLM mock calls through
  const mockFetch = setupMockFetch({
    getPythonPort,
    getLLMMockPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler
      }
    ]
  });

  beforeEach(async () => {
    // Fresh database per test — prevents state bleed between tests
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    await initTestDatabase(TEST_DB_PATH);
    jest.clearAllMocks();
    mockFetch.mockClear();
    // Reset LLM mock call history and config queue between tests
    await getLLMMockServer!().reset();
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  // ==========================================================================
  // Test 1: Frontend tool interrupted — next LLM call has valid tool_use/tool_result history
  // ==========================================================================

  it('UserInputTool interrupted by new message — LLM receives valid paired tool_use/tool_result history', async () => {
    // ---- Step 1: MultiToolAgent dispatches UserInputTool (frontend) ----
    // No LLM mock needed — MultiToolAgent is a hardcoded test agent.
    const response1 = await chatPostHandler(createNextRequest({
      user_message: 'What is revenue?',
      agent: 'MultiToolAgent',
      agent_args: { goal: 'What is revenue?' }
    }));
    const r1 = await response1.json();

    console.log('[Test 1] Step 1 response:', JSON.stringify(r1, null, 2));

    expect(response1.status).toBe(200);
    expect(r1.error).toBeNull();
    // UserInputTool must be pending at the frontend level
    expect(r1.pending_tool_calls).toHaveLength(1);
    expect(r1.pending_tool_calls[0].function.name).toBe('UserInputTool');
    // UserInputToolBackend was executed by Next.js backend
    expect(r1.completed_tool_calls).toHaveLength(1);
    expect(r1.completed_tool_calls[0].function.name).toBe('UserInputToolBackend');

    const conversationID = r1.conversationID;
    const logIndex = r1.log_index;

    // ---- Step 2: Configure LLM mock for AnalystAgent call ----
    // The validateRequest function is serialized to a string and eval'd inside
    // the mock server process — it MUST be self-contained (no external closures).
    await getLLMMockServer!().configure({
      validateRequest: (req) => {
        const messages = req.messages;

        // Rule 1: every assistant tool_call has a matching tool_result
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              const hasResult = messages.slice(i + 1).some(
                (m: any) => m.role === 'tool' && m.tool_call_id === tc.id
              );
              if (!hasResult) {
                throw new Error(
                  'Missing tool_result for tool_call_id=' + tc.id +
                  ' (tool: ' + (tc.function && tc.function.name) + ')'
                );
              }
            }
          }
        }

        // Rule 2: no consecutive assistant messages (LLM API hard constraint)
        for (let i = 1; i < messages.length; i++) {
          if (messages[i].role === 'assistant' && messages[i - 1].role === 'assistant') {
            throw new Error(
              'Consecutive assistant messages at indices ' + (i - 1) + ' and ' + i
            );
          }
        }

        // Rule 3: every tool_result has a preceding tool_call
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'tool' && msg.tool_call_id) {
            const hasCall = messages.slice(0, i).some(
              (m: any) =>
                m.role === 'assistant' &&
                m.tool_calls &&
                m.tool_calls.some((tc: any) => tc.id === msg.tool_call_id)
            );
            if (!hasCall) {
              throw new Error(
                'tool_result at index ' + i + ' has no preceding tool_call: id=' + msg.tool_call_id
              );
            }
          }
        }

        // Assert UserInputTool was interrupted — it must appear as a valid tool_result
        const hasInterrupted = messages.some(
          (m: any) =>
            m.role === 'tool' &&
            typeof m.content === 'string' &&
            m.content.includes('<Interrupted />')
        );
        if (!hasInterrupted) {
          throw new Error(
            'Expected at least one tool_result with <Interrupted /> content — ' +
            'UserInputTool should be marked interrupted when a new user message arrives'
          );
        }

        return true;
      },
      response: {
        content: 'Revenue for last quarter was $4.2M.',
        role: 'assistant',
        tool_calls: [],
        finish_reason: 'stop'
      },
      usage: { total_tokens: 60, prompt_tokens: 50, completion_tokens: 10 }
    });

    // ---- Step 3: New user message interrupts UserInputTool, AnalystAgent calls LLM ----
    // user_message is set → Python sets interrupt_pending=True → UserInputTool gets
    // TaskResult('<Interrupted />') in memory → AnalystAgent._get_history() builds a
    // thread with [user(msg1), assistant([UserInputTool, UserInputToolBackend]),
    // tool(UserInputTool,'<Interrupted />'), tool(UserInputToolBackend,'Backend...')]
    // → our validateRequest validates that history satisfies LLM API constraints.
    const response2 = await chatPostHandler(createNextRequest({
      conversationID,
      log_index: logIndex,
      user_message: 'Actually show me top customers instead',
      agent: 'AnalystAgent',
      agent_args: { goal: 'Actually show me top customers instead' }
    }));
    const r2 = await response2.json();

    console.log('[Test 1] Step 2 response:', JSON.stringify(r2, null, 2));

    // If validateRequest threw, Python received 400 → error propagated
    expect(response2.status).toBe(200);
    expect(r2.error).toBeNull();

    // Confirm LLM was called exactly once (validateRequest ran and passed)
    const calls = await getLLMMockServer!().getCalls();
    expect(calls).toHaveLength(1);
  });

  // ==========================================================================
  // Test 2: LLM error mid-session — DB unchanged, recovery has valid history
  // ==========================================================================

  it('LLM error returns logDiff=[] — recovery message sees interrupted tool in valid history', async () => {
    // ---- Step 1: MultiToolAgent → UserInputTool pending ----
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

    // ---- Step 2: New message → AnalystAgent → LLM mock EMPTY → error ----
    // No configure() call → mock queue is empty → mock returns HTTP 500 →
    // Python allm_request throws → endpoint handler returns ConversationResponse(logDiff=[])
    // → Next.js route returns { error: '...', log_index: same as r1 }
    const response2 = await chatPostHandler(createNextRequest({
      conversationID,
      log_index: logIndex,
      user_message: 'What are top customers?',
      agent: 'AnalystAgent',
      agent_args: { goal: 'What are top customers?' }
    }));
    const r2 = await response2.json();

    console.log('[Test 2] Step 2 response (expected error):', JSON.stringify(r2, null, 2));

    // The LLM call failed → soft error in Python response
    expect(r2.error).toBeTruthy();
    // logDiff=[] → DB unchanged → log_index unchanged
    expect(r2.log_index).toBe(logIndex);
    // conversationID unchanged (no fork since no new log entries)
    expect(r2.conversationID).toBe(conversationID);

    // ---- Step 3: Configure LLM mock for recovery call ----
    // Same validation as Test 1: interrupted tool must appear with valid pairing.
    // Key: DB still has UserInputTool with result=None (error left DB unchanged),
    // so Python will interrupt it again for this new message.
    await getLLMMockServer!().configure({
      validateRequest: (req) => {
        const messages = req.messages;

        // Rule 1: every assistant tool_call has a matching tool_result
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              const hasResult = messages.slice(i + 1).some(
                (m: any) => m.role === 'tool' && m.tool_call_id === tc.id
              );
              if (!hasResult) {
                throw new Error(
                  'Missing tool_result for tool_call_id=' + tc.id +
                  ' (tool: ' + (tc.function && tc.function.name) + ')'
                );
              }
            }
          }
        }

        // Rule 2: no consecutive assistant messages
        for (let i = 1; i < messages.length; i++) {
          if (messages[i].role === 'assistant' && messages[i - 1].role === 'assistant') {
            throw new Error(
              'Consecutive assistant messages at indices ' + (i - 1) + ' and ' + i
            );
          }
        }

        // Rule 3: every tool_result has a preceding tool_call
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'tool' && msg.tool_call_id) {
            const hasCall = messages.slice(0, i).some(
              (m: any) =>
                m.role === 'assistant' &&
                m.tool_calls &&
                m.tool_calls.some((tc: any) => tc.id === msg.tool_call_id)
            );
            if (!hasCall) {
              throw new Error(
                'tool_result at index ' + i + ' has no preceding tool_call: id=' + msg.tool_call_id
              );
            }
          }
        }

        // UserInputTool must be interrupted again — DB still shows it as pending
        // (the earlier error left logDiff=[] so the <Interrupted /> was never saved)
        const hasInterrupted = messages.some(
          (m: any) =>
            m.role === 'tool' &&
            typeof m.content === 'string' &&
            m.content.includes('<Interrupted />')
        );
        if (!hasInterrupted) {
          throw new Error(
            'Expected tool_result with <Interrupted /> content — DB log was not modified by the ' +
            'earlier error (logDiff=[]), so UserInputTool should still be pending and get interrupted'
          );
        }

        return true;
      },
      response: {
        content: 'Top 5 customers by revenue: Alice ($1.2M), Bob ($0.9M)...',
        role: 'assistant',
        tool_calls: [],
        finish_reason: 'stop'
      },
      usage: { total_tokens: 80, prompt_tokens: 70, completion_tokens: 10 }
    });

    // ---- Step 4: Recovery message — uses same conversationID + log_index as r2 ----
    // r2.conversationID === r1.conversationID (no fork)
    // r2.log_index === r1.log_index (logDiff=[] means no advancement)
    // Python loads DB log → finds UserInputTool still pending → interrupts → LLM validates
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

    // LLM was called once: only the recovery call (r2 had no successful LLM call)
    const calls = await getLLMMockServer!().getCalls();
    expect(calls).toHaveLength(1);
  });
});
