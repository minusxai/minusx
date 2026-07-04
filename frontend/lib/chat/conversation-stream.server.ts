/**
 * Chat Architecture v3 — the live wakeup bus for conversation streaming.
 *
 * A turn writes durable `messages` rows (the source of truth) and then `notify`s a pointer; the SSE
 * endpoint `subscribe`s and, on each wakeup, does a catch-up SELECT. Token deltas ride inline (small,
 * ephemeral). The transport is Postgres LISTEN/NOTIFY (works on PGLite and Postgres alike); a NOTIFY
 * lost while nobody listens is harmless because correctness comes from the cursor + SELECT.
 *
 * One LISTEN per conversation channel is shared by all in-process subscribers (fan-out via a local
 * Set, bounded by live connections). See docs/chat-architecture-v3.md §7.
 */
import { getModules } from '@/lib/modules/registry';
import type { ConversationNotify, RunStatus } from '@/lib/data/conversations.types';

// Optional channel namespace. By default conversation ids form one shared id-space, so the
// channel is just `conv_<id>`. A deployment whose conversation ids are NOT globally unique
// (e.g. allocated within a narrower request scope) can install a namespace so ids that
// repeat across scopes never share a LISTEN/NOTIFY channel — the transport is process/DB-
// global and not scope-aware on its own. Default: no namespace (single id-space).
let channelNamespace: () => Promise<string> = async () => '';

/** Install a channel-namespace provider (returns a safe identifier fragment, or '' for none). */
export function setConversationChannelNamespace(fn: () => Promise<string>): void {
  channelNamespace = fn;
}

/** Fully-qualified, safe-identifier channel for a conversation, including any namespace. */
async function resolveChannel(conversationId: number): Promise<string> {
  const ns = await channelNamespace();
  const base = `conv_${conversationId}`;
  return ns ? `${ns}_${base}` : base;
}

type Handler = (n: ConversationNotify) => void;

interface ChannelSub {
  handlers: Set<Handler>;
  /** The adapter-level LISTEN teardown, resolved once. */
  unlisten: () => Promise<void>;
}

// Intentionally process-global: the per-conversation LISTEN fan-out registry. Keyed by the
// fully-resolved channel string (incl. any namespace) so ids that repeat across scopes
// never collide on one registry entry. Bounded by live SSE connections and
// fully rebuildable (the DB is the source of truth) — see docs/chat-architecture-v3.md §7.
// eslint-disable-next-line no-restricted-syntax
const channels = new Map<string, ChannelSub>();

function db() {
  const mod = getModules().db;
  if (!mod.notify || !mod.listen) throw new Error('DB module does not support LISTEN/NOTIFY');
  return mod as Required<Pick<typeof mod, 'notify' | 'listen'>> & typeof mod;
}

/** Emit a wakeup pointer on the conversation's channel. */
export async function publish(conversationId: number, n: ConversationNotify): Promise<void> {
  await db().notify(await resolveChannel(conversationId), JSON.stringify(n));
}

/** New committed message(s) up to `seq` are available — go SELECT them. */
export const notifyMessage = (conversationId: number, seq: number): Promise<void> =>
  publish(conversationId, { kind: 'message', seq });

/** Ephemeral token chunk for the in-flight message at `seq`. `thinking` marks reasoning tokens. */
export const notifyDelta = (conversationId: number, seq: number, text: string, thinking = false): Promise<void> =>
  publish(conversationId, { kind: 'delta', seq, text, ...(thinking ? { thinking: true } : {}) });

/** Run lifecycle transition (running/paused/idle/error). */
export const notifyStatus = (conversationId: number, runStatus: RunStatus, seq: number): Promise<void> =>
  publish(conversationId, { kind: 'status', seq, runStatus });

/** Ask the active turn (wherever it runs) to cancel — the "Stop" button. */
export const notifyInterrupt = (conversationId: number): Promise<void> =>
  publish(conversationId, { kind: 'interrupt', seq: -1 });

/**
 * Subscribe to a conversation's wakeups. The first subscriber opens the DB LISTEN; the last to
 * unsubscribe closes it. Returns an async unsubscribe.
 */
export async function subscribe(conversationId: number, handler: Handler): Promise<() => Promise<void>> {
  const channel = await resolveChannel(conversationId);
  let sub = channels.get(channel);
  if (!sub) {
    const handlers = new Set<Handler>();
    const unlisten = await db().listen(channel, (payload) => {
      let parsed: ConversationNotify;
      try { parsed = JSON.parse(payload) as ConversationNotify; } catch { return; }
      // Snapshot to tolerate handlers unsubscribing during iteration.
      for (const h of [...handlers]) {
        try { h(parsed); } catch { /* a dead writer must not break others */ }
      }
    });
    sub = { handlers, unlisten };
    channels.set(channel, sub);
  }
  sub.handlers.add(handler);

  return async () => {
    const current = channels.get(channel);
    if (!current) return;
    current.handlers.delete(handler);
    if (current.handlers.size === 0) {
      channels.delete(channel);
      try { await current.unlisten(); } catch { /* connection already gone */ }
    }
  };
}
