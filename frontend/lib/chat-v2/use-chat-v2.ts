// Chat-v2 toggle — purely URL-driven (`?v=`). No Redux, no localStorage.
// Single source of truth: the URL. v2 (JS orchestrator) is the DEFAULT engine
// (see DEFAULT_CHAT_VERSION) — only an explicit `?v=1` opts into the legacy
// Conversations surface. The settings page flips it via a full page reload
// (`window.location.href = setVInUrl(next)`); navigation preserves the param
// via the same `preserveParams` machinery as `as_user` / `mode` (see
// lib/navigation/url-utils.ts).

import { useSearchParams } from 'next/navigation';
import { isV2 } from './chat-version';

/**
 * Pure logic: returns true iff the search string resolves to the v2 engine.
 * v2 is the default, so this is true unless `v=1` is present. Tolerates a
 * leading `?` or its absence.
 */
export function resolveUseChatV2(search: string): boolean {
  const params = new URLSearchParams(
    search && search.startsWith('?') ? search.slice(1) : search,
  );
  return isV2(params.get('v'));
}

/**
 * React hook: returns the effective `useChatV2` value by reading `?v=` from
 * the current URL via Next.js' `useSearchParams`. The subscription means
 * consumers auto-re-render on navigation. When params are unavailable (SSR for
 * some routes), fall back to the default engine (v2).
 */
export function useUseChatV2(): boolean {
  const params = useSearchParams();
  return isV2(params?.get('v'));
}

/**
 * Whether an opened conversation is a legacy (v1) chat being viewed in v2 mode.
 * The v2 (JS) engine can't continue a v1 conversation — the forked agent gets no
 * context — so the chat surface shows the read-only history plus a "New Chat" CTA
 * instead of an input. Fires only when: v2 mode is on, a conversation is open, and
 * its file version is KNOWN and v1 (version 1). v2 (orchestrator files) and v3 (dedicated tables)
 * are both continuable; unknown/undefined (e.g. an in-session-created chat not yet reloaded) is
 * treated as continuable, never legacy. See useConversation (sets version from meta / v3 load).
 */
export function isLegacyChatInV2(
  useChatV2: boolean,
  conversationId: number | null | undefined,
  conversationVersion: number | null | undefined,
): boolean {
  return useChatV2 && conversationId != null && conversationVersion != null && conversationVersion < 2;
}
