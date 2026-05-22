// `useChatV2` is now URL-only — no Redux state, no localStorage.
// `resolveUseChatV2(search)` decides whether the chat-v2 surface is on by
// reading `?v=` from the URL search string. v2 (JS orchestrator) is the
// DEFAULT engine, so only an explicit `?v=1` turns it off. Settings UI flips
// it via `setVInUrl` which assigns `window.location.href` (full reload).

import { resolveUseChatV2 } from '@/lib/chat-v2/use-chat-v2';

describe('useChatV2 — URL only (v2 is default)', () => {
  it('returns true when v=2 is in the search string', () => {
    expect(resolveUseChatV2('?v=2')).toBe(true);
    expect(resolveUseChatV2('?v=2&mode=tutorial')).toBe(true);
    expect(resolveUseChatV2('?other=foo&v=2')).toBe(true);
  });

  it('returns true by default (absent / empty / unrelated v)', () => {
    expect(resolveUseChatV2('')).toBe(true);
    expect(resolveUseChatV2('?v=')).toBe(true);
    expect(resolveUseChatV2('?other=foo')).toBe(true);
  });

  it('returns false only when explicitly v=1', () => {
    expect(resolveUseChatV2('?v=1')).toBe(false);
    expect(resolveUseChatV2('?v=1&mode=tutorial')).toBe(false);
  });

  it('tolerates missing leading ? in the search string', () => {
    expect(resolveUseChatV2('v=2')).toBe(true);
    expect(resolveUseChatV2('v=1')).toBe(false);
  });
});
