/**
 * Chat Architecture v3 — client ConversationsAPI (browser HTTP).
 *
 * Thin wrappers over the /api/conversations routes; mode/as_user are injected by middleware headers,
 * so callers just use relative URLs. The server-side counterpart is lib/data/conversations.server.ts.
 */
import type { Conversation, ConversationErrorRow, MessageRow } from './conversations.types';
import type { ConversationSummary } from '@/app/api/conversations/route';

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

  async get(id: number): Promise<ConversationDetail> {
    const res = await fetch(`/api/conversations/${id}`);
    return unwrap(res);
  },

  /** Cheap single-row fetch of the AI-generated title (null if not generated yet). */
  async getTitle(id: number): Promise<string | null> {
    const res = await fetch(`/api/conversations/${id}/title`);
    const body = await unwrap<{ title: string | null }>(res);
    return body.title;
  },

  async remove(id: number): Promise<void> {
    const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    await unwrap(res);
  },
};
