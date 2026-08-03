// deleteAndForkMessage: "delete from here" on a past user message forks the
// conversation at that point (copies messages [0, logIndex)) and moves Redux to
// the fork — WITHOUT running an agent turn. The original conversation is never
// mutated server-side (same append-only contract as editAndForkMessage; the
// fork endpoint is shared). The key behavioral difference from edit-and-fork,
// pinned here: no POST to the fork's /turns, and the fork ends idle, so the
// user lands on a truncated conversation with an empty composer.

import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { createConversation, deleteAndForkMessage, selectConversation } from '@/store/chatSlice';
import type { RootState } from '@/store/store';

describe('deleteAndForkMessage → truncating fork, no agent run', () => {
  let store: ReturnType<typeof makeStore>;
  let calls: Array<{ url: string; method: string; body?: unknown }>;
  const SRC = 100;
  const NEWID = 777;

  beforeEach(() => {
    store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    calls = [];
    global.fetch = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes('/fork')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { id: NEWID, conversation: { id: NEWID } } }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as Response;
    }) as never;
  });

  afterEach(() => vi.restoreAllMocks());

  it('forks at the message logIndex, moves Redux to the fork, and never starts a turn', async () => {
    store.dispatch(createConversation({ conversationID: SRC, agent: 'WebAnalystAgent', agent_args: {} as never, version: 3 }));

    store.dispatch(deleteAndForkMessage({ conversationID: SRC, logIndex: 2 }));

    // The fork must be created in Redux at NEWID (nav follows from updateConversation).
    await vi.waitFor(
      () => expect(selectConversation(store.getState() as RootState, NEWID)).toBeTruthy(),
      { timeout: 2000, interval: 10 },
    );

    // Fork was requested at the delete point…
    const fork = calls.find((c) => c.method === 'POST' && c.url.includes(`/api/conversations/${SRC}/fork`));
    expect(fork, 'fork endpoint must be called on the SOURCE conversation').toBeTruthy();
    expect((fork!.body as { atSeq?: number })?.atSeq, 'fork at the deleted message logIndex').toBe(2);

    // …and — the whole point — NO agent turn starts on the fork.
    expect(
      calls.some((c) => c.method === 'POST' && c.url.includes('/turns')),
      'delete-and-fork must NOT start an agent run',
    ).toBe(false);

    // The fork is idle, ready for whatever the user types next.
    const forked = selectConversation(store.getState() as RootState, NEWID);
    expect(forked?.executionState).not.toBe('WAITING');
    expect(forked?.executionState).not.toBe('EXECUTING');
  });
});
