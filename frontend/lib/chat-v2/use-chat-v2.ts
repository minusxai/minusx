// Chat-v2 toggle — purely URL-driven (`?v=2`). No Redux, no localStorage.
// Single source of truth: the URL. The settings page flips it via a full
// page reload (`window.location.href = setVInUrl(next)`); navigation
// preserves it via the same `preserveParams` machinery as `as_user` /
// `mode` (see lib/navigation/url-utils.ts).

import { useSearchParams } from 'next/navigation';

/**
 * Pure logic: returns true iff the search string contains `v=2`.
 * Tolerates leading `?` or its absence.
 */
export function resolveUseChatV2(search: string): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get('v') === '2';
}

/**
 * React hook: returns the effective `useChatV2` value by reading
 * `?v=2` from the current URL via Next.js' `useSearchParams`. The
 * subscription means consumers auto-re-render on navigation. Server-side
 * (`useSearchParams` returns `null` during SSR for some routes): returns false.
 */
export function useUseChatV2(): boolean {
  const params = useSearchParams();
  if (!params) return false;
  return params.get('v') === '2';
}

/**
 * Whether an opened conversation is a legacy (v1) chat being viewed in v2 mode.
 * The v2 (JS) engine can't continue a v1 conversation — the forked agent gets no
 * context — so the chat surface shows the read-only history plus a "New Chat" CTA
 * instead of an input. Fires only when: v2 mode is on, a conversation is open, and
 * its file version is KNOWN and not 2 (v1 files load with version 1; v2 with 2;
 * unknown/undefined — e.g. an in-session-created chat not yet reloaded — is treated
 * as continuable, never legacy). See useConversation (sets version from meta).
 */
export function isLegacyChatInV2(
  useChatV2: boolean,
  conversationId: number | null | undefined,
  conversationVersion: number | null | undefined,
): boolean {
  return useChatV2 && conversationId != null && conversationVersion != null && conversationVersion !== 2;
}
