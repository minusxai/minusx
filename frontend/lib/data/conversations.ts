/**
 * Chat Architecture v3 — client ConversationsAPI (browser HTTP).
 *
 * Thin wrappers over the /api/conversations routes; mode/as_user are injected by middleware headers,
 * so callers just use relative URLs. The server-side counterpart is lib/data/conversations.server.ts.
 */
import type { Conversation, ConversationErrorRow, MessageRow } from './conversations.types';
import type { ConversationView } from './conversation-projection';
import type { ConversationSummary } from '@/app/api/conversations/route';

/** Options for ConversationsAPI.get (see /conversations-v2.md). */
export interface GetConversationOpts {
  /** 'full' = verbatim pi log (dev mode only); default 'display' = slim projection. */
  view?: ConversationView;
  /** Return only messages with seq > sinceSeq (incremental post-turn reload). */
  sinceSeq?: number;
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { error?: unknown })?.error) {
    const err = (body as { error?: { message?: string } | string }).error;
    throw new Error((typeof err === 'object' ? err?.message : err) || `HTTP ${res.status}`);
  }
  // successResponse wraps in { data }; the list/create routes return their payload directly.
  return ((body as { data?: T }).data ?? (body as T));
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: MessageRow[];
  errors: ConversationErrorRow[];
  /** Highest committed message seq (-1 if empty). Lets an incremental (`sinceSeq`) caller detect
   *  server-side truncation (retry/replay rewrote the tail) and fall back to a full fetch. */
  maxSeq?: number;
}

export const ConversationsAPI = {
  async create(opts: { agent?: string; title?: string; firstMessage?: string } = {}): Promise<{ id: number; conversation: Conversation }> {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    return unwrap(res);
  },

  async list(): Promise<ConversationSummary[]> {
    const res = await fetch('/api/conversations');
    const body = await unwrap<{ conversations: ConversationSummary[] }>(res);
    return body.conversations;
  },

  async get(id: number, opts: GetConversationOpts = {}): Promise<ConversationDetail> {
    const qs = new URLSearchParams();
    if (opts.view === 'full') qs.set('view', 'full'); // 'display' is the server default
    if (opts.sinceSeq !== undefined) qs.set('since', String(opts.sinceSeq));
    const query = qs.size > 0 ? `?${qs.toString()}` : '';
    const res = await fetch(`/api/conversations/${id}${query}`);
    const detail = await unwrap<ConversationDetail>(res);
    // A 2xx with a malformed/empty body (proxy page, truncated/interrupted response) would otherwise
    // pass through as `{}` and crash callers at `detail.messages.map(...)` with a cryptic
    // `reading 'map'` TypeError (Sentry MINUSX-BI-2V). Fail loudly + retryably instead.
    if (!detail || !Array.isArray(detail.messages) || !Array.isArray(detail.errors)) {
      throw new Error(`Malformed conversation ${id} response (missing messages/errors) — the request may have been interrupted; please retry.`);
    }
    return detail;
  },

  /** Cheap single-row fetch of the AI-generated title (null if not generated yet). */
  async getTitle(id: number): Promise<string | null> {
    const res = await fetch(`/api/conversations/${id}/title`);
    const body = await unwrap<{ title: string | null }>(res);
    return body.title;
  },

  /** Rename a conversation (sets an explicit title, shown in the list + header). */
  async rename(id: number, title: string): Promise<void> {
    const res = await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    await unwrap(res);
  },

  async remove(id: number): Promise<void> {
    const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    await unwrap(res);
  },
};
