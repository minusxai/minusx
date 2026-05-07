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
