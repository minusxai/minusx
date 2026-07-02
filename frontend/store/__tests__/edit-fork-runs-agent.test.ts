// Editing a previous user message and hitting Enter must actually START THE AGENT on the fork.
//
// Regression guarded here: the fork API (`POST /api/conversations/:id/fork`) returns a
// `successResponse` envelope — `{ success: true, data: { id, conversation } }` — but the
// editAndForkMessage listener parsed `id` from the TOP level (`const { id: newId } = await
// res.json()`), so `newId` came back `undefined`. That silently skipped creating the fork in
// Redux (`updateConversation` early-returns on a falsy id) and made `runV3TurnInListener` bail
// at its `if (!conversation) return` guard. Net user symptom: the edited conversation is
// truncated but the agent never runs — "the conversation just ends".

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { createConversation, editAndForkMessage, selectConversation } from '@/store/chatSlice';
import type { RootState } from '@/store/store';

describe('editAndForkMessage → agent runs on the fork', () => {
  let store: ReturnType<typeof makeStore>;
  let calls: Array<{ url: string; method: string }>;
  const SRC = 100;
  const NEWID = 777;

  beforeEach(() => {
    store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    calls = [];
    global.fetch = vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });
      if (url.includes('/fork')) {
        // The real route wraps the payload in a successResponse envelope: id lives under `data`.
        return { ok: true, status: 200, json: async () => ({ success: true, data: { id: NEWID, conversation: { id: NEWID } } }) } as Response;
      }
      if (url.includes('/turns')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as Response;
      }
      // GET /api/conversations/:id — return a settled run so the listener's poll exits at once.
      return { ok: true, status: 200, json: async () => ({ success: true, data: { conversation: { runStatus: 'idle' }, messages: [], errors: [] } }) } as Response;
    }) as never;
  });

  afterEach(() => vi.restoreAllMocks());

  it('parses the forked id from the successResponse envelope and POSTs the turn to the fork', async () => {
    // Seed a source conversation (no initial message → no auto-run; isolates the fork path).
    store.dispatch(createConversation({ conversationID: SRC, agent: 'WebAnalystAgent', agent_args: {} as never, version: 3 }));

    // User edits a previous message and presses Enter.
    store.dispatch(editAndForkMessage({ conversationID: SRC, logIndex: 0, message: 'edited question' }));

    // The fork must be created in Redux at NEWID — proves `newId` was parsed, not undefined.
    await vi.waitFor(
      () => expect(selectConversation(store.getState() as RootState, NEWID)).toBeTruthy(),
      { timeout: 2000, interval: 10 },
    );

    // And the agent run must be POSTed to the FORK's turns endpoint — the user-visible symptom.
    await vi.waitFor(
      () => expect(calls.some(c => c.method === 'POST' && c.url.includes(`/api/conversations/${NEWID}/turns`))).toBe(true),
      { timeout: 2000, interval: 10 },
    );
  });
});
