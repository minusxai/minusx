// `useChatV2` is now URL-only — no Redux state, no localStorage.
// `resolveUseChatV2(search)` decides whether the chat-v2 surface is on by
// reading `?v=2` from the URL search string. Settings UI flips it via
// `setVInUrl` which assigns `window.location.href` (full reload).

import { resolveUseChatV2 } from '@/lib/chat-v2/use-chat-v2';

describe('useChatV2 — URL only (?v=2)', () => {
  it('returns true only when v=2 is in the search string', () => {
    expect(resolveUseChatV2('?v=2')).toBe(true);
    expect(resolveUseChatV2('?v=2&mode=tutorial')).toBe(true);
    expect(resolveUseChatV2('?other=foo&v=2')).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(resolveUseChatV2('')).toBe(false);
    expect(resolveUseChatV2('?v=1')).toBe(false);
    expect(resolveUseChatV2('?v=')).toBe(false);
    expect(resolveUseChatV2('?other=foo')).toBe(false);
  });

  it('tolerates missing leading ? in the search string', () => {
    expect(resolveUseChatV2('v=2')).toBe(true);
    expect(resolveUseChatV2('v=1')).toBe(false);
  });
});
