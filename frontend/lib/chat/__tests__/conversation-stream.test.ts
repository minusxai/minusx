// The LISTEN/NOTIFY wakeup bus, end-to-end on a real PGLite DB: a publish reaches a subscriber,
// delta payloads ride inline, and unsubscribing stops delivery. This proves PGLite LISTEN/NOTIFY
// works through the adapter (the v3 streaming transport).

import { subscribe, notifyMessage, notifyDelta, setConversationChannelNamespace } from '@/lib/chat/conversation-stream.server';
import type { ConversationNotify } from '@/lib/data/conversations.types';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('conversation_stream');

/** Wait until `received` has at least `n` items, or throw after a timeout. */
async function waitFor(received: unknown[], n: number, ms = 2000): Promise<void> {
  const start = Date.now();
  while (received.length < n) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${n} notifies (got ${received.length})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('conversation stream bus (LISTEN/NOTIFY)', () => {
  setupTestDb(TEST_DB_PATH);

  it('delivers message + delta wakeups to a subscriber, then stops after unsubscribe', async () => {
    const received: ConversationNotify[] = [];
    const unsubscribe = await subscribe(4242, (n) => received.push(n));

    await notifyMessage(4242, 0);
    await notifyDelta(4242, 1, 'hello');
    await waitFor(received, 2);

    expect(received[0]).toEqual({ kind: 'message', seq: 0 });
    expect(received[1]).toEqual({ kind: 'delta', seq: 1, text: 'hello' });

    await unsubscribe();
    await notifyMessage(4242, 2);
    // Give any stray delivery a chance, then assert nothing new arrived.
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toHaveLength(2);
  });

  it('isolates channels by conversation id', async () => {
    const a: ConversationNotify[] = [];
    const b: ConversationNotify[] = [];
    const unsubA = await subscribe(101, (n) => a.push(n));
    const unsubB = await subscribe(202, (n) => b.push(n));

    await notifyMessage(101, 5);
    await waitFor(a, 1);
    await new Promise((r) => setTimeout(r, 50));

    expect(a).toEqual([{ kind: 'message', seq: 5 }]);
    expect(b).toHaveLength(0); // conversation 202 heard nothing

    await unsubA();
    await unsubB();
  });

  describe('channel namespace (scoped id-spaces)', () => {
    // When conversation ids are NOT globally unique (e.g. allocated within a narrower request
    // scope), a namespace keeps two scopes that share a raw id from cross-delivering —
    // including the inline `delta` text payload, which would otherwise leak across the scope.
    afterEach(() => setConversationChannelNamespace(async () => '')); // restore default

    it('two scopes sharing one conversation id do not cross-deliver', async () => {
      let ns = 'a';
      setConversationChannelNamespace(async () => ns);

      const a: ConversationNotify[] = [];
      const b: ConversationNotify[] = [];
      ns = 'a'; const unsubA = await subscribe(7, (n) => a.push(n));
      ns = 'b'; const unsubB = await subscribe(7, (n) => b.push(n)); // same id, other scope

      ns = 'a'; await notifyDelta(7, 0, 'scope-a-secret-token');
      await waitFor(a, 1);
      await new Promise((r) => setTimeout(r, 50));

      expect(a).toEqual([{ kind: 'delta', seq: 0, text: 'scope-a-secret-token' }]);
      expect(b).toHaveLength(0); // scope b never saw scope a's delta

      await unsubA();
      await unsubB();
    });
  });
});
