// chatListener in-flight guard: a listener re-fire must NOT re-run a tool call
// that is still executing (result not set yet) — otherwise concurrent firings
// explode into a re-execution storm.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// executeToolCall is gated so the call stays "in flight" while we re-fire the listener.
const h = vi.hoisted(() => {
  const gate = { resolve: (() => {}) as () => void };
  const gatePromise = new Promise<void>(res => { gate.resolve = res; });
  const executeToolCall = vi.fn(async () => { await gatePromise; return { role: 'tool', content: '{}' }; });
  return { executeToolCall, releaseGate: () => gate.resolve() };
});

vi.mock('@/lib/api/tool-handlers', async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  executeToolCall: h.executeToolCall,
}));

import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { createConversation, updateConversation } from '@/store/chatSlice';

describe('chatListener: in-flight tool-call guard', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as Response)) as never;
    h.executeToolCall.mockClear();
  });

  afterEach(() => {
    h.releaseGate();          // let the gated call finish so nothing hangs
    vi.restoreAllMocks();
  });

  it('does not re-run a tool call that is already executing when the listener re-fires', async () => {
    const CONV = 4242;
    store.dispatch(createConversation({ conversationID: CONV, agent: 'WebAnalystAgent', agent_args: {} as never }));

    const pending = [{ id: 'tc1', type: 'function', function: { name: 'ExecuteQuery', arguments: {} } }];

    // First firing → starts executing tc1, which stays in-flight (gated).
    store.dispatch(updateConversation({ conversationID: CONV, log_index: 1, completed_tool_calls: [], pending_tool_calls: pending as never }));
    await vi.waitFor(() => expect(h.executeToolCall).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 10 });

    // Re-fire the listener (what completeToolCall → updateConversation does in prod) while tc1 is still in-flight.
    store.dispatch(updateConversation({ conversationID: CONV, log_index: 2, completed_tool_calls: [], pending_tool_calls: pending as never }));
    await new Promise(r => setTimeout(r, 60)); // give the second effect a chance to (wrongly) re-run

    // Guard holds: still exactly one execution, not two.
    expect(h.executeToolCall).toHaveBeenCalledTimes(1);
  });
});
