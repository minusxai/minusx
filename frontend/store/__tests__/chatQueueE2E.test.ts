/**
 * Chat Queue E2E Tests
 *
 * Tests the message queuing system: users can send messages while the agent
 * is running. Queued messages are sent when the agent finishes (end-of-turn)
 * or with tool results (mid-turn).
 *
 * Covers:
 *   1. queueMessage adds to queue without changing executionState
 *   2. Queue auto-sends when conversation finishes (end-of-turn, via FINISHED listener)
 *   3. Queue survives interruption and sets wasInterrupted flag
 *   4. Queue is cleared when user sends normally after interrupt
 *   5. flushQueuedMessages moves queue to messages array
 *
 * Run: npm test -- store/__tests__/chatQueueE2E.test.ts
 */

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_chat_queue.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

import {
  createConversation,
  sendMessage,
  queueMessage,
  clearQueuedMessages,
  flushQueuedMessages,
  interruptChat,
  selectConversation,
  completeToolCall,
} from '../chatSlice';
import { setAllowChatQueue } from '../uiSlice';
import type { RootState } from '../store';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { waitFor, getTestDbPath } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('chat_queue');

describe('Chat Queue E2E', () => {
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
  const { getStore } = setupTestDb(TEST_DB_PATH);

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  // ── Unit tests for queue reducers (no backend needed) ──────────────

  it('queueMessage adds to queue without changing executionState', () => {
    const store = getStore();
    const conversationID = -100;

    store.dispatch(createConversation({
      conversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'initial'
    }));

    // executionState should be WAITING after creating with a message
    let conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.executionState).toBe('WAITING');

    store.dispatch(queueMessage({
      conversationID,
      message: 'follow up 1'
    }));

    conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.queuedMessages).toHaveLength(1);
    expect(conv.queuedMessages![0].message).toBe('follow up 1');
    // executionState unchanged
    expect(conv.executionState).toBe('WAITING');

    store.dispatch(queueMessage({
      conversationID,
      message: 'follow up 2'
    }));

    conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.queuedMessages).toHaveLength(2);
    expect(conv.queuedMessages![1].message).toBe('follow up 2');
  });

  it('clearQueuedMessages empties the queue', () => {
    const store = getStore();
    const conversationID = -101;

    // Create with a message so state is WAITING (queue won't auto-send)
    store.dispatch(createConversation({
      conversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'initial',
    }));

    store.dispatch(queueMessage({ conversationID, message: 'msg1' }));
    store.dispatch(queueMessage({ conversationID, message: 'msg2' }));

    let conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.queuedMessages).toHaveLength(2);

    store.dispatch(clearQueuedMessages({ conversationID }));

    conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.queuedMessages).toHaveLength(0);
  });

  it('flushQueuedMessages moves queue to messages as a combined user message', () => {
    const store = getStore();
    const conversationID = -102;

    // Create with a message so state is WAITING (not FINISHED)
    store.dispatch(createConversation({
      conversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'initial',
    }));

    store.dispatch(queueMessage({ conversationID, message: 'part 1' }));
    store.dispatch(queueMessage({ conversationID, message: 'part 2' }));

    store.dispatch(flushQueuedMessages({ conversationID }));

    const conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.queuedMessages).toHaveLength(0);

    // Should have initial user message + combined queued message
    const userMessages = conv.messages.filter(m => m.role === 'user');
    expect(userMessages).toHaveLength(2);
    expect(userMessages[1].content).toBe('part 1\n\npart 2');
  });

  it('interruptChat sets wasInterrupted and preserves queuedMessages', () => {
    const store = getStore();
    const conversationID = -103;

    store.dispatch(createConversation({
      conversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'start'
    }));

    store.dispatch(queueMessage({ conversationID, message: 'queued msg' }));

    store.dispatch(interruptChat({ conversationID }));

    const conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.executionState).toBe('FINISHED');
    expect(conv.wasInterrupted).toBe(true);
    // Queue is preserved for prefill
    expect(conv.queuedMessages).toHaveLength(1);
    expect(conv.queuedMessages![0].message).toBe('queued msg');
  });

  it('sendMessage clears wasInterrupted flag', () => {
    const store = getStore();
    const conversationID = -104;

    store.dispatch(createConversation({
      conversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'start'
    }));

    store.dispatch(interruptChat({ conversationID }));

    let conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.wasInterrupted).toBe(true);

    store.dispatch(sendMessage({ conversationID, message: 'new message' }));

    conv = selectConversation(store.getState() as RootState, conversationID)!;
    expect(conv.wasInterrupted).toBe(false);
    expect(conv.executionState).toBe('WAITING');
  });

  // ── E2E test: queue auto-sends after conversation finishes ─────────

  it('queued messages auto-send when conversation finishes (end-of-turn)', async () => {
    const store = getStore();
    const conversationID = -200;

    store.dispatch(setAllowChatQueue(true));

    // Step 1: Create conversation and send initial message
    store.dispatch(createConversation({
      conversationID,
      agent: 'MultiToolAgent',
      agent_args: { goal: 'Testing queue' },
      message: 'initial question'
    }));

    // Step 2: Wait for conversation to reach EXECUTING or FINISHED
    let realConversationID = conversationID;
    await waitFor(() => {
      const tempConv = selectConversation(store.getState() as RootState, conversationID);
      if (tempConv?.forkedConversationID) {
        realConversationID = tempConv.forkedConversationID;
      }
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED' || c?.executionState === 'EXECUTING';
    }, 15000);

    // Step 3: Complete any pending frontend tools first
    let conv = selectConversation(store.getState() as RootState, realConversationID)!;
    if (conv.executionState === 'EXECUTING') {
      for (const pending of conv.pending_tool_calls) {
        if (!pending.result) {
          store.dispatch(completeToolCall({
            conversationID: realConversationID,
            tool_call_id: pending.toolCall.id,
            result: {
              role: 'tool',
              tool_call_id: pending.toolCall.id,
              content: 'Tool completed',
              created_at: new Date().toISOString()
            }
          }));
        }
      }
    }

    // Step 4: Wait for first turn to finish
    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, realConversationID);
      if (!c) return false;
      return c.executionState === 'FINISHED';
    }, 15000);

    // Step 5: Queue a message — the listener should auto-send since conversation is FINISHED
    store.dispatch(queueMessage({
      conversationID: realConversationID,
      message: 'also summarize'
    }));

    // Step 6: Wait for the queued message to be consumed and the new turn to finish
    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, realConversationID);
      if (!c) return false;
      return c.executionState === 'FINISHED' &&
        (!c.queuedMessages || c.queuedMessages.length === 0);
    }, 15000);

    // Step 6: Verify the queued message was sent as a user message
    conv = selectConversation(store.getState() as RootState, realConversationID)!;
    const userMessages = conv.messages.filter(m => m.role === 'user');
    // Should have at least 2 user messages: initial + queued
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
    const queuedUserMsg = userMessages.find(m => m.content === 'also summarize');
    expect(queuedUserMsg).toBeDefined();
  }, 30000);
});
