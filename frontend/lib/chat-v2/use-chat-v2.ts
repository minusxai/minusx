// Helpers for the Phase-3 useChatV2 toggle. Pref lives in uiSlice; URL
// override (?v=2) wins over the pref.

import { useAppSelector } from '@/store/hooks';
import { selectUseChatV2 } from '@/store/uiSlice';

/**
 * Pure logic: combine the persisted preference with a URL search-string.
 * Used directly in tests; the hook below wraps it for React components.
 */
export function resolveUseChatV2(prefValue: boolean, search: string): boolean {
  if (prefValue) return true;
  if (!search) return false;
  // Tolerate both leading-? and bare query strings.
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get('v') === '2';
}

/**
 * React hook: returns the effective `useChatV2` value, honoring the URL
 * override on browser-side. Server components should use `resolveUseChatV2`
 * directly off `searchParams` since they can't subscribe to Redux.
 */
export function useUseChatV2(): boolean {
  const pref = useAppSelector(selectUseChatV2);
  if (typeof window === 'undefined') return pref;
  return resolveUseChatV2(pref, window.location.search);
}
