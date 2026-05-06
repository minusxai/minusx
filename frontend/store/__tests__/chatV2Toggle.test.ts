// Phase 3 — useChatV2 toggle + helpers.
//
// `useChatV2` is a UI-state preference: when true, the sidebar swaps
// Conversations → Chats and "/f/<id>" / "/explore/<id>" route to the v2 chat
// renderer. The URL `?v=2` overrides for QA.
//
// These are pure-Redux/util tests — no DOM. The Sidebar component test
// would live alongside other `*.ui.test.tsx`.

import { configureStore } from '@reduxjs/toolkit';
import uiReducer, {
  setUseChatV2,
  selectUseChatV2,
} from '../uiSlice';
import { resolveUseChatV2 } from '@/lib/chat-v2/use-chat-v2';

function makeUiStore() {
  return configureStore({ reducer: { ui: uiReducer } });
}

describe('useChatV2 — uiSlice toggle', () => {
  it('defaults to false', () => {
    const store = makeUiStore();
    expect(selectUseChatV2(store.getState())).toBe(false);
  });

  it('flips to true when setUseChatV2(true) is dispatched', () => {
    const store = makeUiStore();
    store.dispatch(setUseChatV2(true));
    expect(selectUseChatV2(store.getState())).toBe(true);
  });
});

describe('useChatV2 — URL override (?v=2)', () => {
  it('returns true when URL has v=2 even if the pref is off', () => {
    expect(resolveUseChatV2(false, '?v=2')).toBe(true);
  });

  it('returns true when pref is on', () => {
    expect(resolveUseChatV2(true, '')).toBe(true);
    expect(resolveUseChatV2(true, '?other=foo')).toBe(true);
  });

  it('returns false when pref is off and no v=2 override', () => {
    expect(resolveUseChatV2(false, '')).toBe(false);
    expect(resolveUseChatV2(false, '?v=1')).toBe(false);
  });
});
