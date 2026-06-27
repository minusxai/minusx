import { describe, it, expect } from 'vitest';
import {
  CONTEXT_BUDGETS,
  tokensToChars,
  PER_DOC_CONTENT_CHARS,
  isDocContentOverLimit,
} from '@/lib/context/context-budgets';

describe('context-budgets', () => {
  it('converts tokens to chars via charsPerToken', () => {
    expect(tokensToChars(100)).toBe(100 * CONTEXT_BUDGETS.charsPerToken);
    expect(PER_DOC_CONTENT_CHARS).toBe(CONTEXT_BUDGETS.perDocTokens * CONTEXT_BUDGETS.charsPerToken);
  });

  it('flags doc content over the per-doc cap', () => {
    expect(isDocContentOverLimit('a'.repeat(PER_DOC_CONTENT_CHARS))).toBe(false); // exactly at cap is OK
    expect(isDocContentOverLimit('a'.repeat(PER_DOC_CONTENT_CHARS + 1))).toBe(true);
    expect(isDocContentOverLimit('')).toBe(false);
  });
});
