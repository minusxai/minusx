// Queued messages must survive the end-of-turn re-render.
//
// The bug: while a turn runs, `queueMessage` appends to the LIVE slice state, but the
// turn-completion path re-renders via `loadConversation({ conversation: { ...snapshot } })`
// where `snapshot` was captured before/at turn start. `loadConversation` used to blind-replace
// the conversation, so a message queued mid-turn was silently wiped. And even a surviving
// queue had no flush trigger: the auto-send listener matched only
// `updateConversation | queueMessage`, while an idle finish dispatches `loadConversation`.

import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import {
  createConversation,
  loadConversation,
  queueMessage,
  selectConversation,
  type Conversation,
} from '@/store/chatSlice';
import type { RootState } from '@/store/store';

describe('queued messages survive the end-of-turn render', () => {
  let store: ReturnType<typeof makeStore>;
  const CONV = 5001;

  beforeEach(() => {
    store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as Response)) as never;
    store.dispatch(createConversation({ conversationID: CONV, agent: 'WebAnalystAgent', agent_args: {} as never, message: 'first question' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function snapshotNow(): Conversation {
    // What the turn listener holds: the conversation as of turn start.
    return { ...selectConversation(store.getState() as RootState, CONV)! };
  }

  /** Pin the live conversation to EXECUTING — the state a real turn is in when the user queues. */
  function startTurn(): Conversation {
    const snapshot = { ...snapshotNow(), executionState: 'EXECUTING' as const };
    store.dispatch(loadConversation({ conversation: snapshot, setAsActive: false }));
    return snapshot;
  }

  it('loadConversation does not wipe messages queued while the turn was running', () => {
    const snapshot = startTurn(); // taken BEFORE the user queues anything

    store.dispatch(queueMessage({ conversationID: CONV, message: 'queued mid-turn' }));
    // Mid-turn: the message must actually be queued (not flush-sent — the turn is running).
    expect(selectConversation(store.getState() as RootState, CONV)!.queuedMessages).toHaveLength(1);

    // Turn finishes → final render from the durable log uses the stale snapshot.
    store.dispatch(loadConversation({
      conversation: { ...snapshot, executionState: 'FINISHED' },
      setAsActive: false,
    }));

    const conv = selectConversation(store.getState() as RootState, CONV)!;
    const queued = (conv.queuedMessages ?? []).map((q) => q.message);
    const sent = conv.messages.filter((m) => m.role === 'user').map((m) => m.content);
    // Not lost: either still queued, or already flushed into the message list.
    expect([...queued, ...sent]).toContain('queued mid-turn');
  });

  it('a queued message auto-sends when the turn finishes via loadConversation', async () => {
    const snapshot = startTurn();
    store.dispatch(queueMessage({ conversationID: CONV, message: 'queued mid-turn' }));
    store.dispatch(loadConversation({
      conversation: { ...snapshot, executionState: 'FINISHED' },
      setAsActive: false,
    }));

    await vi.waitFor(() => {
      const conv = selectConversation(store.getState() as RootState, CONV)!;
      const sent = conv.messages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(sent).toContain('queued mid-turn');
      expect(conv.queuedMessages ?? []).toHaveLength(0);
    }, { timeout: 5000, interval: 20 });
  });
});
