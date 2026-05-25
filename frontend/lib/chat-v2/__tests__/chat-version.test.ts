import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHAT_VERSION,
  resolveChatVersion,
  isV2,
} from '../chat-version';

// The chat engine is selected by a single number that unifies three concepts:
// the URL `?v=` param, the conversation file's `meta.version`, and the engine
// (1 = legacy, 2 = JS orchestrator). `DEFAULT_CHAT_VERSION` is
// what an absent/unrecognized `?v=` falls back to — flip it to change the
// default engine for everyone (and to roll back).

describe('DEFAULT_CHAT_VERSION', () => {
  it('is 2 — the JS orchestrator is the default engine', () => {
    expect(DEFAULT_CHAT_VERSION).toBe(2);
  });
});

describe('resolveChatVersion', () => {
  it('explicit ?v=1 → 1 (legacy), ?v=2 → 2 (JS orchestrator)', () => {
    expect(resolveChatVersion('1')).toBe(1);
    expect(resolveChatVersion('2')).toBe(2);
  });

  it('absent / empty / unrecognized → DEFAULT_CHAT_VERSION', () => {
    expect(resolveChatVersion(null)).toBe(DEFAULT_CHAT_VERSION);
    expect(resolveChatVersion(undefined)).toBe(DEFAULT_CHAT_VERSION);
    expect(resolveChatVersion('')).toBe(DEFAULT_CHAT_VERSION);
    expect(resolveChatVersion('foo')).toBe(DEFAULT_CHAT_VERSION);
    expect(resolveChatVersion('3')).toBe(DEFAULT_CHAT_VERSION);
  });
});

describe('isV2', () => {
  it('true unless the request resolves to version 1', () => {
    expect(isV2('2')).toBe(true);
    expect(isV2(null)).toBe(true); // default is 2
    expect(isV2('')).toBe(true);
    expect(isV2('1')).toBe(false);
  });
});
