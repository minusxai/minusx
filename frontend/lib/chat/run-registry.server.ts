import 'server-only';
import type { V2LegacyStreamingEvent } from '@/lib/chat-orchestration-v2.server';

/**
 * In-flight chat run registry — decouples a chat turn's lifecycle from the HTTP
 * connection that started it, enabling reconnect+resume after transport drops.
 *
 * Why this exists: /api/chat/stream used to drive the turn's generator directly
 * from the response-writing loop. When the client disconnected mid-turn, the
 * write rejected, the loop broke, and the generator's persist-on-finally fired
 * with a HALF-DONE log — the engine's eventual completion was never saved (data
 * loss), and the client had nothing to reconnect to.
 *
 * Now the registry owns the run: a detached pump drains the turn generator into
 * a per-conversation buffer of sequence-numbered frames. HTTP connections are
 * pure observers (`attach`) that replay from any sequence number and tail the
 * live run. Client disconnects detach an observer; the pump — and therefore the
 * generator's persistence — always runs to completion.
 *
 * Finished runs are retained for RETENTION_MS so a client that lost its
 * connection near the end can still resume and receive the `done` frame.
 *
 * NOTE: per-process state. With a single Node process (current deployment) this
 * covers all reconnects except across server restarts. Multi-instance deploys
 * would need sticky sessions or an external buffer.
 */

export interface SequencedFrame {
  seq: number;
  frame: V2LegacyStreamingEvent;
}

interface RunEntry {
  frames: SequencedFrame[];
  done: boolean;
  waiters: Array<() => void>;
  evictTimer: ReturnType<typeof setTimeout> | null;
  /** Cancels the underlying orchestrator run (registered once setup completes). */
  cancel: (() => void) | null;
  /** True if an interrupt arrived before the cancel hook was registered. */
  cancelRequested: boolean;
}

const RETENTION_MS = 5 * 60 * 1000;

// eslint-disable-next-line no-restricted-syntax -- mutable per-process server state, keyed per conversation; entries are evicted RETENTION_MS after their run finishes
const runs = new Map<number, RunEntry>();

function notify(entry: RunEntry): void {
  const waiters = entry.waiters.splice(0, entry.waiters.length);
  for (const w of waiters) w();
}

/**
 * Start a new run for a conversation: a detached pump drains `generator` into
 * the buffer regardless of any HTTP connection's fate. Replaces any previous
 * (finished or abandoned) entry for the conversation.
 */
export function startRun(
  conversationId: number,
  generator: AsyncGenerator<V2LegacyStreamingEvent, void, unknown>,
): void {
  const previous = runs.get(conversationId);
  if (previous?.evictTimer) clearTimeout(previous.evictTimer);

  const entry: RunEntry = { frames: [], done: false, waiters: [], evictTimer: null, cancel: null, cancelRequested: false };
  runs.set(conversationId, entry);

  void (async () => {
    try {
      for await (const frame of generator) {
        entry.frames.push({ seq: entry.frames.length + 1, frame });
        notify(entry);
      }
    } catch (err) {
      // The turn generator converts its own errors into error/done frames;
      // anything escaping here is a pump-level bug — log, never throw.
      console.error('[run-registry] pump failed:', err);
    } finally {
      entry.done = true;
      notify(entry);
      entry.evictTimer = setTimeout(() => {
        if (runs.get(conversationId) === entry) runs.delete(conversationId);
      }, RETENTION_MS);
      // Don't hold the process open for eviction housekeeping.
      entry.evictTimer.unref?.();
    }
  })();
}

/** True if the conversation has a live or recently-finished run to attach to. */
export function hasRun(conversationId: number): boolean {
  return runs.has(conversationId);
}

/**
 * Register the cancel hook for a conversation's live run (called from inside
 * the turn generator once the orchestrator exists). If an interrupt already
 * arrived, fire it immediately.
 */
export function registerCancel(conversationId: number, cancel: () => void): void {
  const entry = runs.get(conversationId);
  if (!entry || entry.done) return;
  entry.cancel = cancel;
  if (entry.cancelRequested) cancel();
}

/**
 * Interrupt a conversation's live run: cancels the orchestrator (aborting
 * in-flight LLM/tool work), after which the turn winds down and persists its
 * partial log normally. Returns true if there was a live run to interrupt.
 */
export function interruptRun(conversationId: number): boolean {
  const entry = runs.get(conversationId);
  if (!entry || entry.done) return false;
  entry.cancelRequested = true;
  entry.cancel?.();
  return true;
}

/**
 * Attach to a conversation's run as an observer: yields buffered frames with
 * `seq > afterSeq`, then live frames as the pump appends them, returning once
 * the run is done and fully replayed. Returns null when there is nothing to
 * attach to (no run started this process lifetime, or evicted).
 */
export function attach(
  conversationId: number,
  afterSeq: number,
): AsyncGenerator<SequencedFrame, void, unknown> | null {
  const entry = runs.get(conversationId);
  if (!entry) return null;

  return (async function* observe() {
    let next = Math.max(0, afterSeq); // frames[i].seq === i + 1
    for (;;) {
      while (next < entry.frames.length) {
        yield entry.frames[next];
        next += 1;
      }
      if (entry.done) return;
      await new Promise<void>((resolve) => entry.waiters.push(resolve));
    }
  })();
}

/** Test-only: drop all registry state. */
export function __clearAllRuns(): void {
  for (const entry of runs.values()) {
    if (entry.evictTimer) clearTimeout(entry.evictTimer);
    entry.done = true;
    notify(entry);
  }
  runs.clear();
}
