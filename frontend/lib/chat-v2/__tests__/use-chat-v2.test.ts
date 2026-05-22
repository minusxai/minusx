import { describe, it, expect } from 'vitest';
import { resolveUseChatV2, isLegacyChatInV2 } from '../use-chat-v2';

describe('resolveUseChatV2', () => {
  // v2 (JS orchestrator) is the default engine; only an explicit ?v=1 opts out.
  it('true for v=2 and for the default (no/empty/other v); false only for v=1', () => {
    expect(resolveUseChatV2('?v=2')).toBe(true);
    expect(resolveUseChatV2('v=2')).toBe(true);
    expect(resolveUseChatV2('')).toBe(true); // absent → DEFAULT_CHAT_VERSION (2)
    expect(resolveUseChatV2('?other=foo')).toBe(true);
    expect(resolveUseChatV2('?v=1')).toBe(false);
  });
});

describe('isLegacyChatInV2', () => {
  it('true: v2 mode + open v1 conversation (version 1)', () => {
    expect(isLegacyChatInV2(true, 42, 1)).toBe(true);
  });

  it('false: v2 conversation (version 2)', () => {
    expect(isLegacyChatInV2(true, 42, 2)).toBe(false);
  });

  it('false: not in v2 mode (v1 chat continues normally via Python)', () => {
    expect(isLegacyChatInV2(false, 42, 1)).toBe(false);
  });

  it('false: no conversation open (new chat)', () => {
    expect(isLegacyChatInV2(true, undefined, undefined)).toBe(false);
  });

  it('false: version unknown — never misflag an in-session/cached v2 chat as legacy', () => {
    expect(isLegacyChatInV2(true, 42, undefined)).toBe(false);
    expect(isLegacyChatInV2(true, 42, null)).toBe(false);
  });
});
