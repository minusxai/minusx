/**
 * Postgres jsonb/text cannot store a NUL (U+0000) — a write containing one fails with
 * `unsupported Unicode escape sequence`. `stripNulChars` removes every NUL from the value graph
 * before it reaches the driver. These tests pin the pure sanitizer; the DB-level reproduction lives
 * in store/__tests__/nul-jsonb-write.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { stripNulChars } from '../sanitize-jsonb';

const NUL = String.fromCharCode(0);

describe('stripNulChars', () => {
  it('removes NUL characters from a string', () => {
    expect(stripNulChars(`bad${NUL}value`)).toBe('badvalue');
    expect(stripNulChars(`${NUL}${NUL}x${NUL}`)).toBe('x');
  });

  it('returns the SAME reference when a subtree is already clean (no allocation)', () => {
    const clean = { a: 1, b: 'ok', c: [1, 2, { d: 'fine' }] };
    expect(stripNulChars(clean)).toBe(clean);
    const arr = ['a', 'b'];
    expect(stripNulChars(arr)).toBe(arr);
    const s = 'no nul here';
    expect(stripNulChars(s)).toBe(s);
  });

  it('recurses into nested objects and arrays', () => {
    const input = {
      entries: [
        { role: 'tool', text: `cell${NUL}data` },
        { role: 'user', text: 'clean' },
      ],
      meta: { note: `a${NUL}b` },
    };
    expect(stripNulChars(input)).toEqual({
      entries: [
        { role: 'tool', text: 'celldata' },
        { role: 'user', text: 'clean' },
      ],
      meta: { note: 'ab' },
    });
  });

  it('leaves non-string primitives untouched', () => {
    expect(stripNulChars(42)).toBe(42);
    expect(stripNulChars(true)).toBe(true);
    expect(stripNulChars(null)).toBe(null);
    expect(stripNulChars(undefined)).toBe(undefined);
  });

  it('strips NUL that appears in object keys', () => {
    const input = { [`k${NUL}ey`]: 'v' };
    expect(stripNulChars(input)).toEqual({ key: 'v' });
  });

  it('does not recurse into non-plain objects (e.g. Date) — returns them as-is', () => {
    const d = new Date('2026-07-02T00:00:00Z');
    const input = { when: d };
    const out = stripNulChars(input);
    expect(out.when).toBe(d);
  });
});
