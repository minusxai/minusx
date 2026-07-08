/**
 * A read-view of the Redux store with `ui.colorMode` pinned — for render surfaces that must
 * theme to a DECLARED mode rather than the app's (a story that says colorMode:"light" inside a
 * dark app). Chart components all read `state.ui.colorMode` directly, and they all render into
 * the story iframe through StoryEmbeds' nested-root Provider — so overriding at that single
 * Provider themes the entire embedded chart stack without touching any reader.
 *
 * dispatch/subscribe pass through untouched (writes and reactivity hit the real store); only
 * getState is wrapped, memoized per underlying state reference so selector identity shortcuts
 * keep working.
 */
import type { Store } from '@reduxjs/toolkit';
import type { RootState } from '@/store/store';

export function withColorModeOverride<S extends Store<RootState>>(
  store: S,
  colorMode: 'light' | 'dark' | undefined,
): S {
  if (!colorMode) return store;
  let lastRaw: RootState | null = null;
  let lastWrapped: RootState | null = null;
  const getState = (): RootState => {
    const raw = store.getState();
    if (raw !== lastRaw || !lastWrapped) {
      lastRaw = raw;
      lastWrapped = raw.ui.colorMode === colorMode ? raw : { ...raw, ui: { ...raw.ui, colorMode } };
    }
    return lastWrapped;
  };
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'getState') return getState;
      return Reflect.get(target, prop, receiver);
    },
  }) as S;
}
