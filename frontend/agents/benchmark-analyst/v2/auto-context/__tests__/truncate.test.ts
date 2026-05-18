/**
 * Tests for truncate.ts — the per-value cap that prevents blob-heavy
 * columns (README content, commit messages, narrative descriptions)
 * from blowing past the lighter-model's context window when AutoContext
 * serialises sample rows into its LLM prompts.
 */

import { describe, it, expect } from 'vitest';
import { truncateValue, truncateRow, truncateValues, DEFAULT_MAX_VALUE_CHARS } from '../truncate';

describe('truncateValue', () => {
  it('passes short strings through unchanged', () => {
    expect(truncateValue('hello')).toBe('hello');
  });

  it('passes non-string values through unchanged', () => {
    expect(truncateValue(42)).toBe(42);
    expect(truncateValue(true)).toBe(true);
    expect(truncateValue(null)).toBeNull();
    expect(truncateValue(undefined)).toBeUndefined();
    expect(truncateValue({ a: 1 })).toEqual({ a: 1 });
  });

  it('truncates strings longer than the cap and appends a size marker', () => {
    const big = 'x'.repeat(DEFAULT_MAX_VALUE_CHARS + 1000);
    const out = truncateValue(big);
    expect(typeof out).toBe('string');
    const s = out as string;
    expect(s.length).toBeLessThan(big.length);
    expect(s.startsWith('x'.repeat(DEFAULT_MAX_VALUE_CHARS))).toBe(true);
    expect(s).toMatch(/\+1000 more chars/);
  });

  it('honours a custom maxChars limit', () => {
    const out = truncateValue('abcdefghij', 4) as string;
    expect(out).toMatch(/^abcd…<\+6 more chars>$/);
  });
});

describe('truncateRow', () => {
  it('truncates only the long string fields in a row', () => {
    const row = {
      id: 1,
      name: 'short name',
      content: 'x'.repeat(DEFAULT_MAX_VALUE_CHARS + 500),
      tag: null,
    };
    const out = truncateRow(row);
    expect(out.id).toBe(1);
    expect(out.name).toBe('short name');
    expect(out.tag).toBeNull();
    expect((out.content as string).length).toBeLessThan((row.content as string).length);
  });
});

describe('truncateValues', () => {
  it('returns the array with each element individually truncated', () => {
    const arr = ['short', 'x'.repeat(DEFAULT_MAX_VALUE_CHARS + 100), 42];
    const out = truncateValues(arr);
    expect(out[0]).toBe('short');
    expect(typeof out[1]).toBe('string');
    expect((out[1] as string).length).toBeLessThan((arr[1] as string).length);
    expect(out[2]).toBe(42);
  });
});
