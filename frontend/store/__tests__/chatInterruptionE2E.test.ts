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

  // ==========================================================================
  // Test 3: Clarify tool interrupted — cascade <Interrupted /> to parent Clarify
  // ==========================================================================

  it('Clarify (FrontendToolException) interrupted — parent Clarify gets <Interrupted /> so LLM history is valid', async () => {
    // ---- Step 1: AnalystAgent calls LLM → returns Clarify tool call ----
    // LLM mock returns a Clarify tool_call. Python dispatches Clarify.
    // Next.js Clarify handler throws FrontendToolException → spawns ClarifyFrontend.
    // Frontend receives pending_tool_calls=[ClarifyFrontend].
    const clarifyId = 'test_clarify_id_001';
    await getLLMMockServer!().configure({
      response: {
        content: '',
        role: 'assistant',
        tool_calls: [{
          id: clarifyId,
          type: 'function',
          function: {
            name: 'Clarify',
            arguments: JSON.stringify({
              question: 'Which metric do you want to analyze?',
              options: [{ label: 'Revenue' }, { label: 'Orders' }],
              multiSelect: false
            })
          }
        }],
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
    // ClarifyFrontend must be the pending tool at the frontend level
    expect(r1.pending_tool_calls).toHaveLength(1);
    expect(r1.pending_tool_calls[0].function.name).toBe('ClarifyFrontend');
    // The ClarifyFrontend id is different from clarifyId (it gets a new id in Next.js)
    expect(r1.pending_tool_calls[0]._parent_unique_id).toBe(clarifyId);

    const conversationID = r1.conversationID;
    const logIndex = r1.log_index;

    // ---- Step 2: Configure LLM mock for recovery call ----
    // The validateRequest ensures both Clarify AND ClarifyFrontend appear as
    // valid tool_result entries — confirming the cascade fix works.
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

        // Assert Clarify was interrupted — it must appear as a valid tool_result
        // This is the key assertion: without the cascade fix, Clarify.result=None
        // causes task_batch_to_thread to emit assistant([Clarify]) with NO tool_result.
        const hasClarifyInterrupted = messages.some(
          (m: any) =>
            m.role === 'tool' &&
            typeof m.content === 'string' &&
            m.content.includes('<Interrupted />')
        );
        if (!hasClarifyInterrupted) {
          throw new Error(
            'Expected a tool_result with <Interrupted /> for the Clarify tool. ' +
            'The cascade fix should mark Clarify as interrupted after ClarifyFrontend is interrupted.'
          );
        }

        return true;
      },
      response: {
        content: 'I can show you both Revenue and Orders metrics.',
        role: 'assistant',
        tool_calls: [],
        finish_reason: 'stop'
      },
      usage: { total_tokens: 60, prompt_tokens: 50, completion_tokens: 10 }
    });

    // ---- Step 3: New user message interrupts ClarifyFrontend + cascades to Clarify ----
    // The fix in conversation.py should cascade <Interrupted /> from ClarifyFrontend
    // up to Clarify (its parent), so the LLM history has a valid tool_result for Clarify.
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

    // LLM was called twice: once for Clarify (step 1) + once for recovery (step 3)
    const calls = await getLLMMockServer!().getCalls();
    expect(calls).toHaveLength(2);
  });

  // ==========================================================================
  // Test 4: AnalystAgent dispatches ReadFiles (non-Clarify frontend tool) via LLM →
  //         user interrupts with new message → LLM history remains valid
  // ==========================================================================

  it('ReadFiles (non-Clarify frontend tool) interrupted by new message — LLM receives valid history', async () => {
    // ReadFiles is NOT in the primary toolRegistry (only fallback), so Next.js
    // passes it through to the frontend as a remainingPendingTool.
    // This test verifies that the interrupt/recovery path works for ALL
    // frontend tools, not just Clarify.

    const readFilesId = 'test_readfiles_id_001';

    // ---- Step 1: Configure LLM mock → AnalystAgent calls ReadFiles ----
    await getLLMMockServer!().configure({
      response: {
        content: '',
        role: 'assistant',
        tool_calls: [{
          id: readFilesId,
          type: 'function',
          function: {
            name: 'ReadFiles',
            arguments: JSON.stringify({ fileIds: [42] })
          }
        }],
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
    // ReadFiles is a frontend tool — it must be pending at the frontend level
    expect(r1.pending_tool_calls).toHaveLength(1);
    expect(r1.pending_tool_calls[0].function.name).toBe('ReadFiles');
    expect(r1.pending_tool_calls[0].id).toBe(readFilesId);

    const conversationID = r1.conversationID;
    const logIndex = r1.log_index;

    // ---- Step 2: Configure LLM mock for recovery call ----
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

        // ReadFiles must be interrupted
        const hasInterrupted = messages.some(
          (m: any) =>
            m.role === 'tool' &&
            typeof m.content === 'string' &&
            m.content.includes('<Interrupted />')
        );
        if (!hasInterrupted) {
          throw new Error(
            'Expected a tool_result with <Interrupted /> for ReadFiles.'
          );
        }

        // Verify ReadFiles specifically is what got interrupted
        const readFilesInterrupted = messages.some(
          (m: any) => m.role === 'tool' && m.tool_call_id === 'test_readfiles_id_001' &&
            typeof m.content === 'string' && m.content.includes('<Interrupted />')
        );
        if (!readFilesInterrupted) {
          throw new Error(
            'Expected tool_result for ReadFiles (id=test_readfiles_id_001) to contain <Interrupted />'
          );
        }

        return true;
      },
      response: {
        content: 'I can help you with that instead.',
        role: 'assistant',
        tool_calls: [],
        finish_reason: 'stop'
      },
      usage: { total_tokens: 50, prompt_tokens: 40, completion_tokens: 10 }
    });

    // ---- Step 3: New user message interrupts ReadFiles ----
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

    // LLM was called twice: once for ReadFiles dispatch + once for recovery
    const calls = await getLLMMockServer!().getCalls();
    expect(calls).toHaveLength(2);
  });

  // ==========================================================================
  // Test 5: Completed turn + LLM error on next turn → recovery works cleanly
  //
  // This is the "pure Anthropic error" scenario: Turn 1 completes successfully
  // with a text response (no pending tools). Turn 2 gets an LLM error (logDiff=[]).
  // Turn 3 must continue with valid conversation history.
  // ==========================================================================

  it('Completed turn + LLM error on subsequent turn — user can continue conversation cleanly', async () => {
    // ---- Step 1: Turn 1 — AnalystAgent completes with text answer ----
    await getLLMMockServer!().configure({
      response: {
        content: 'Revenue for Q3 was $4.2M.',
        role: 'assistant',
        tool_calls: [],
        finish_reason: 'stop'
      },
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

    // ---- Step 2: Turn 2 — LLM mock empty → error (simulates Anthropic API error) ----
    // No configure() call → mock queue is empty → mock returns HTTP 500 →
    // Python throws → logDiff=[] → DB unchanged
    const response2 = await chatPostHandler(createNextRequest({
      conversationID,
      log_index: logIndex,
      user_message: 'What about Q4?',
      agent: 'AnalystAgent',
      agent_args: { goal: 'What about Q4?' }
    }));
    const r2 = await response2.json();

    console.log('[Test 5] Step 2 response (expected LLM error):', JSON.stringify(r2, null, 2));

    // LLM error → soft error returned
    expect(r2.error).toBeTruthy();
    // DB unchanged → log_index unchanged
    expect(r2.log_index).toBe(logIndex);
    expect(r2.conversationID).toBe(conversationID);
    expect(r2.pending_tool_calls).toHaveLength(0);

    // ---- Step 3: Turn 3 — User retries → LLM responds, history has Turn 1 context ----
    await getLLMMockServer!().configure({
      validateRequest: (req) => {
        const messages = req.messages;

        // No tool calls in this conversation — just alternating user/assistant messages
        // Rule: no consecutive same-role messages
        for (let i = 1; i < messages.length; i++) {
          if (messages[i].role === messages[i - 1].role && messages[i].role !== 'system') {
            throw new Error(
              'Consecutive ' + messages[i].role + ' messages at indices ' + (i - 1) + ' and ' + i
            );
          }
        }

        // Turn 1 history must be present: user(msg1) + assistant(text_answer)
        const hasMsg1 = messages.some(
          (m: any) => m.role === 'user' && typeof m.content === 'string' &&
            m.content.includes('Q3')
        );
        if (!hasMsg1) {
          throw new Error('Turn 1 user message (Q3) not found in history for Turn 3 LLM call');
        }

        const hasResponse1 = messages.some(
          (m: any) => m.role === 'assistant' && typeof m.content === 'string' &&
            m.content.includes('$4.2M')
        );
        if (!hasResponse1) {
          throw new Error('Turn 1 assistant response ($4.2M) not found in history for Turn 3 LLM call');
        }

        // The CURRENT turn message should be Q4 (msg3, since msg2 was the failed turn)
        // Note: msg2 (the failed turn) should NOT appear — logDiff=[] means R2 was never saved
        const hasMsg3 = messages.some(
          (m: any) => m.role === 'user' && typeof m.content === 'string' &&
            m.content.includes('Q4')
        );
        if (!hasMsg3) {
          throw new Error('Turn 3 user message (Q4) not found as current message');
        }

        // All tool_use must have tool_results (sanity check — no tools in this convo)
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as any;
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              const hasResult = messages.slice(i + 1).some(
                (m: any) => m.role === 'tool' && m.tool_call_id === tc.id
              );
              if (!hasResult) {
                throw new Error('Missing tool_result for tool_call_id=' + tc.id);
              }
            }
          }
        }

        return true;
      },
      response: {
        content: 'Revenue for Q4 was $5.1M.',
        role: 'assistant',
        tool_calls: [],
        finish_reason: 'stop'
      },
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

    // LLM was called twice: once for Turn 1 + once for Turn 3 recovery
    // (Turn 2 LLM call failed, so mock queue was empty — getCalls returns 2)
    const calls = await getLLMMockServer!().getCalls();
    expect(calls).toHaveLength(2);
  });
});
