/**
 * Edit-and-Fork E2E Tests
 *
 * Tests the full stack for editAndForkMessage:
 *   1. Build a real multi-turn conversation in the DB via chatPostHandler
 *      using AnalystAgent (matches the real Explore page) with LLM mock
 *      returning simple text answers.
 *   2. Load it back into Redux — parseLogToMessages sets logIndex on user
 *      messages, which is required for the truncation in editAndForkMessage
 *      (and matches the real-world flow: the edit pencil only appears after
 *      loading from DB).
 *   3. Dispatch editAndForkMessage → chatListener → /api/chat with log_index
 *      set to the fork point → appendLogToConversation detects stale
 *      log_index → creates a forked conversation.
 *   4. Assert: forkedConversationID on original, new conversation has only
 *      the edited message as its user message.
 *
 * Run: npm test -- store/__tests__/editAndFork.test.ts
 */

// IMPORTANT: jest.mock calls are hoisted before imports.
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import {
  selectConversation,
  editAndForkMessage,
  loadConversation,
} from '../chatSlice';
import type { RootState } from '../store';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { parseLogToMessages } from '@/lib/conversations-utils';
import type { ConversationFile } from '@/lib/conversations';
import {
  waitFor,
  getTestDbPath,
  setupTestStore,
  createNextRequest,
  initTestDatabase,
  cleanupTestDatabase,
} from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';

const TEST_DB_PATH = getTestDbPath('edit_and_fork');

// ============================================================================
// Helper: load conversation from DB via same FilesAPI the route uses,
// then dispatch loadConversation so messages have logIndex set.
// ============================================================================

async function loadConversationIntoRedux(
  store: ReturnType<typeof setupTestStore>,
  conversationID: number,
  logIndex: number
): Promise<void> {
  const { getOrCreateConversation } = await import('@/lib/conversations');

  // Use the same mock user that getEffectiveUser returns in tests
  const mockUser: any = {
    userId: 1,
    email: 'test@example.com',
    role: 'admin',
    mode: 'org',
    home_folder: '/org',
    tokenVersion: 1,
  };

  const { content } = await getOrCreateConversation(conversationID, mockUser);
  // parseLogToMessages sets logIndex on each user message
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

// ============================================================================
// Helper: run one AnalystAgent turn via chatPostHandler with LLM returning
// a simple text answer (no tool calls). Returns { conversationID, log_index }.
// ============================================================================

async function runTurnViaAPI(opts: {
  conversationID?: number;
  log_index?: number;
  message: string;
  llmAnswer: string;
  getLLMMockServer: (() => { configure: (cfg: any) => Promise<void> }) | undefined;
}): Promise<{ conversationID: number; log_index: number }> {
  const { message, llmAnswer, getLLMMockServer } = opts;

  // Configure LLM mock to return a simple text answer
  await getLLMMockServer!().configure({
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

// ============================================================================
// Outer describe: shared Python backend + LLM mock
// ============================================================================

describe('Edit and Fork E2E', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } =
    withPythonBackend({ withLLMMock: true });

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

  let store: ReturnType<typeof setupTestStore>;

  beforeEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    await initTestDatabase(TEST_DB_PATH);
    jest.clearAllMocks();
    mockFetch.mockClear();
    await getLLMMockServer!().reset();
    store = setupTestStore();
  });

  afterEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    store = null as any;
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  // ==========================================================================
  // Test 1: Edit Turn 2's message — fork from end of Turn 1
  // ==========================================================================

  it('forks at the right log_index and the forked conversation contains only the edited message', async () => {
    // ── Build 2 turns in the DB ───────────────────────────────────────────────
    const turn1 = await runTurnViaAPI({
      message: 'First message',
      llmAnswer: 'Answer to first message',
      getLLMMockServer,
    });
    const { conversationID } = turn1;
    const logIndexAfterTurn1 = turn1.log_index;

    const turn2 = await runTurnViaAPI({
      conversationID,
      log_index: logIndexAfterTurn1,
      message: 'Second message',
      llmAnswer: 'Answer to second message',
      getLLMMockServer,
    });
    expect(turn2.log_index).toBeGreaterThan(logIndexAfterTurn1);

    // ── Load conversation into Redux (sets logIndex on user messages) ─────────
    await loadConversationIntoRedux(store, conversationID, turn2.log_index);

    const convLoaded = selectConversation(store.getState() as RootState, conversationID)!;
    const userMsgs = convLoaded.messages.filter(m => m.role === 'user');
    expect(userMsgs).toHaveLength(2);
    // parseLogToMessages must set logIndex on each user message
    expect((userMsgs[0] as any).logIndex).toBeDefined();
    expect((userMsgs[1] as any).logIndex).toBe(logIndexAfterTurn1);

    // ── editAndForkMessage: fork from before Turn 2 ───────────────────────────
    // Configure LLM mock for the forked turn
    await getLLMMockServer!().configure({
      response: {
        content: 'Answer to edited second message',
        role: 'assistant',
        tool_calls: [],
        finish_reason: 'stop',
      },
      usage: { total_tokens: 40, prompt_tokens: 30, completion_tokens: 10 },
    });

    store.dispatch(editAndForkMessage({
      conversationID,
      logIndex: logIndexAfterTurn1,   // log_index sent to API; DB has more → fork
      message: 'Edited second message',
    }));

    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, conversationID);
      return !!c?.forkedConversationID;
    }, 15000);

    const forkedID = selectConversation(store.getState() as RootState, conversationID)!.forkedConversationID!;
    expect(forkedID).not.toBe(conversationID);

    // ── Wait for forked conversation to finish ────────────────────────────────
    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, forkedID);
      return c?.executionState === 'FINISHED';
    }, 15000);

    // ── Assert: forked conversation contains pre-fork history + edited message ─
    const forkedConv = selectConversation(store.getState() as RootState, forkedID)!;
    expect(forkedConv.executionState).toBe('FINISHED');

    // The forked conversation inherits Turn 1's messages as history, then adds
    // the edited Turn 2 message. So there are 2 user messages: Turn 1 + edited.
    const forkedUserMsgs = forkedConv.messages.filter(m => m.role === 'user');
    expect(forkedUserMsgs).toHaveLength(2);
    expect(forkedUserMsgs[0].content).toBe('First message');
    expect(forkedUserMsgs[1].content).toBe('Edited second message');
  });

  // ==========================================================================
  // Test 2: Edit Turn 1's message — fork from logIndex=0 (before everything)
  // ==========================================================================

  it('editAndForkMessage from logIndex=0 produces a conversation with only the new first message', async () => {
    // ── Build 2 turns in the DB ───────────────────────────────────────────────
    const turn1 = await runTurnViaAPI({
      message: 'Original first',
      llmAnswer: 'Answer to original first',
      getLLMMockServer,
    });
    const { conversationID } = turn1;
    const logIndexAfterTurn1 = turn1.log_index;

    const turn2 = await runTurnViaAPI({
      conversationID,
      log_index: logIndexAfterTurn1,
      message: 'Second turn',
      llmAnswer: 'Answer to second turn',
      getLLMMockServer,
    });
    expect(turn2.log_index).toBeGreaterThan(logIndexAfterTurn1);

    // ── Load conversation into Redux ─────────────────────────────────────────
    await loadConversationIntoRedux(store, conversationID, turn2.log_index);

    const convLoaded = selectConversation(store.getState() as RootState, conversationID)!;
    const turn1UserMsg = convLoaded.messages.find(m => m.role === 'user') as any;
    expect(turn1UserMsg.logIndex).toBe(0); // Task entry for Turn 1 is at log position 0

    // ── editAndForkMessage from logIndex=0 ───────────────────────────────────
    // Configure LLM mock for the forked turn
    await getLLMMockServer!().configure({
      response: {
        content: 'Answer to brand new start',
        role: 'assistant',
        tool_calls: [],
        finish_reason: 'stop',
      },
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
});
