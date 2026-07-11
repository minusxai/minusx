/**
 * d3 support in the shared column formatters: `format` (d3 pattern) is the unified
 * vocabulary across ALL viz tiers — the DOM grids (table/pivot) render it via
 * d3-format/d3-time-format, matching what vega renders for charts and recipes.
 * Legacy fields (decimalPoints/prefix/suffix/dateFormat) remain as fallback.
 */
import { describe, it, expect } from 'vitest';
import { formatD3Number, formatD3Date } from '@/lib/chart/chart-format';

describe('formatD3Number', () => {
  it('renders d3 patterns', () => {
    expect(formatD3Number(1234.5, ',.0f')).toBe('1,235');
    expect(formatD3Number(1234.5, '$,.2f')).toBe('$1,234.50');
    expect(formatD3Number(0.123, '.1%')).toBe('12.3%');
    expect(formatD3Number(650000, '.3~s')).toBe('650k');
  });

  it('returns null on an invalid pattern (caller falls back)', () => {
    expect(formatD3Number(1, 'not-a-pattern-%%%')).toBeNull();
  });
});

describe('formatD3Date', () => {
  it('renders d3 time patterns', () => {
    const d = new Date(2026, 0, 31); // Jan 31 2026, local
    expect(formatD3Date(d, '%b %Y')).toBe('Jan 2026');
    expect(formatD3Date(d, '%Y-%m-%d')).toBe('2026-01-31');
  });
});
