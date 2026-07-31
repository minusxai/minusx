/**
 * Truncating a search term must not be able to split an escape pair.
 *
 * `fuzzySearch` builds its SQL by hand and caps the term's length. It escaped
 * first and truncated second: `value.replace(/'/g, "''").slice(0, 200)`. A quote
 * doubled into `''` that straddles index 200 loses its second half, so the literal
 * is left open and the remainder of the statement is parsed as SQL.
 *
 * The boundary is exact — a quote at index 199 of the input is the case that
 * splits — which is why a length cap looks harmless right up until it isn't.
 *
 * Truncate first, escape second: then the cap operates on the raw value and
 * escaping always emits whole pairs.
 */
import { describe, it, expect } from 'vitest';
import { escapeFuzzyTerm, FUZZY_TERM_MAX } from '@/lib/connections/fuzzy-search';

/** A single-quoted literal is well formed when its inner quotes are all doubled. */
function isBalanced(literal: string): boolean {
  let i = 0;
  let quotes = 0;
  for (; i < literal.length; i++) if (literal[i] === "'") quotes++;
  return quotes % 2 === 0;
}

describe('escapeFuzzyTerm', () => {
  it('never leaves an unbalanced literal, at any quote position near the cap', () => {
    // Sweep the boundary rather than guessing which offset straddles it.
    for (let n = FUZZY_TERM_MAX - 5; n <= FUZZY_TERM_MAX + 5; n++) {
      const value = 'x'.repeat(n) + "'" + 'A';
      const escaped = escapeFuzzyTerm(value);
      expect(isBalanced(`'${escaped}'`), `quote at index ${n}`).toBe(true);
    }
  });

  it('caps length measured on the raw value, so escaping cannot overflow it', () => {
    const allQuotes = "'".repeat(FUZZY_TERM_MAX * 2);
    // Every kept quote doubles, so the escaped form is at most twice the cap and
    // — critically — contains only whole pairs.
    expect(isBalanced(`'${escapeFuzzyTerm(allQuotes)}'`)).toBe(true);
  });

  it('still escapes and still truncates', () => {
    expect(escapeFuzzyTerm("O'Brien")).toBe("O''Brien");
    expect(escapeFuzzyTerm('y'.repeat(FUZZY_TERM_MAX + 50))).toBe('y'.repeat(FUZZY_TERM_MAX));
  });
});
