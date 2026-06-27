'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationSummary } from '@/app/api/conversations/route';

/** Keyset cursor for the next page (mirrors the server's nextCursor). */
interface Cursor { updatedAt: string; id: number }

interface Options {
  /** Server-side search query (matched against title + first message). Debounced internally. */
  search?: string;
  /** Page size (default 15). */
  pageSize?: number;
}

interface Result {
  conversations: ConversationSummary[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  /** Fetch the next page (no-op while loading or at the end). */
  loadMore: () => void;
}

/**
 * Keyset-paginated conversation list. Loads the first page on mount (and whenever `search` changes,
 * debounced), and appends pages via `loadMore`. The list endpoint is metadata-only, so each page is
 * cheap regardless of how many messages a conversation has. Stale responses (from a superseded
 * search) are dropped via a request-id guard.
 */
export function useConversationsList({ search = '', pageSize = 15 }: Options = {}): Result {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const reqIdRef = useRef(0);

  const fetchPage = useCallback(async (before: Cursor | null, q: string, reqId: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(pageSize) });
      if (q.trim()) qs.set('q', q.trim());
      if (before) { qs.set('before', before.updatedAt); qs.set('beforeId', String(before.id)); }
      const res = await fetch(`/api/conversations?${qs.toString()}`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (reqId !== reqIdRef.current) return; // a newer search superseded this request — drop it
      if (!res.ok) throw new Error(data?.error || 'Failed to load conversations');
      const page: ConversationSummary[] = data.conversations ?? [];
      setConversations((prev) => (before ? [...prev, ...page] : page));
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
    } catch (e) {
      if (reqId === reqIdRef.current) setError(e instanceof Error ? e.message : 'Failed to load conversations');
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
      loadingRef.current = false;
    }
  }, [pageSize]);

  // (Re)load the first page on mount and whenever the search changes (debounced).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const reqId = ++reqIdRef.current;
      loadingRef.current = false; // allow the fresh search to start even if a page was in flight
      setConversations([]);
      setCursor(null);
      setHasMore(true);
      void fetchPage(null, search, reqId);
    }, search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !cursor) return;
    void fetchPage(cursor, search, reqIdRef.current);
  }, [cursor, search, fetchPage]);

  return { conversations, loading, error, hasMore, loadMore };
}
