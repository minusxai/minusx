/**
 * Conversations V2 — client-side raw pi-log cache + incremental conversation loads
 * (see /conversations-v2.md).
 *
 * The chat finalize path used to re-download the ENTIRE conversation after every turn. This
 * module keeps the (slim or full) raw log per conversation in a module map — deliberately NOT
 * Redux: it's a transport cache, and multi-MB strings in Redux hurt devtools + serialization —
 * so finalize can fetch only the rows past what it already has (`?since=<maxSeq>`).
 *
 * Correctness: seqs are contiguous from 0, so a cached log of length N holds seqs 0..N-1. An
 * incremental response must start exactly at seq N AND the merged log must end at the server's
 * `maxSeq` — anything else (fork, message edit, retry replay truncated the tail) falls back to a
 * full fetch. A view change (dev mode toggle) also invalidates: slim and full entries must never
 * mix in one log.
 */
import type { ConversationLog, ConversationLogEntry } from '@/orchestrator/types';
import type { ConversationView } from '@/lib/data/conversation-projection';
import { ConversationsAPI, type ConversationDetail } from '@/lib/data/conversations';

interface CacheEntry {
  view: ConversationView;
  log: ConversationLog;
}

// eslint-disable-next-line no-restricted-syntax -- client-side (browser tab) transport cache keyed by conversation id; never runs server-side, so there is no cross-request sharing
const cache = new Map<number, CacheEntry>();

/** Drop the cached log for one conversation (or all). Call on fork, message edit, and retries. */
export function invalidateConversationLogCache(conversationId?: number): void {
  if (conversationId === undefined) cache.clear();
  else cache.delete(conversationId);
}

export interface LoadedConversation {
  conversation: ConversationDetail['conversation'];
  errors: ConversationDetail['errors'];
  piLog: ConversationLog;
}

const rowsToEntries = (detail: ConversationDetail): ConversationLogEntry[] =>
  detail.messages.filter((r) => r.seq != null).map((r) => r.content);

/**
 * Load a conversation's detail in the given view, incrementally when a coherent cached prefix
 * exists. Always returns the FULL pi log (cached prefix + fetched suffix) + fresh conversation
 * row and errors. Any seq mismatch falls back to one full fetch (and re-seeds the cache).
 */
export async function loadConversationDetail(
  conversationId: number,
  view: ConversationView,
  opts: { incremental?: boolean } = {},
): Promise<LoadedConversation> {
  const { incremental = true } = opts;
  const cached = cache.get(conversationId);
  const viewOpt = view === 'full' ? { view: 'full' as const } : {};

  if (incremental && cached && cached.view === view && cached.log.length > 0) {
    const detail = await ConversationsAPI.get(conversationId, { ...viewOpt, sinceSeq: cached.log.length - 1 });
    const fresh = rowsToEntries(detail);
    const contiguous = detail.messages
      .filter((r) => r.seq != null)
      .every((r, i) => r.seq === cached.log.length + i);
    const mergedLen = cached.log.length + fresh.length;
    // maxSeq guards against a truncate-and-replay (manual/auto retry): the tail we cached may no
    // longer exist server-side even though `since` returned nothing/contiguous rows.
    const complete = detail.maxSeq === undefined || detail.maxSeq === mergedLen - 1;
    if (contiguous && complete) {
      const log = [...cached.log, ...fresh];
      cache.set(conversationId, { view, log });
      return { conversation: detail.conversation, errors: detail.errors, piLog: log };
    }
  }

  const detail = await ConversationsAPI.get(conversationId, viewOpt);
  const log = rowsToEntries(detail);
  cache.set(conversationId, { view, log });
  return { conversation: detail.conversation, errors: detail.errors, piLog: log };
}
