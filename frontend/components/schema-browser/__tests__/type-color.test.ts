/**
 * getTypeColor is the single source of the column-type accent color, shared by
 * the table tree (SchemaTreeSchemaRow) and the views section (ViewsSection) so a
 * column's type looks identical wherever it's shown. This locks the exact
 * mapping — including the quirks — so extracting/reusing it can't silently drift
 * the table rendering.
 */
import { describe, it, expect } from 'vitest';
import { getTypeColor } from '../type-color';

describe('getTypeColor', () => {
  it('integers/numbers/decimals/floats → accent.teal', () => {
    for (const t of ['BIGINT', 'INTEGER', 'int', 'number', 'DECIMAL(10,2)', 'float8']) {
      expect(getTypeColor(t)).toBe('accent.teal');
    }
  });

  it('string-ish → accent.primary', () => {
    for (const t of ['VARCHAR', 'TEXT', 'char(3)', 'string']) {
      expect(getTypeColor(t)).toBe('accent.primary');
    }
  });

  it('temporal → accent.secondary', () => {
    for (const t of ['DATE', 'TIMESTAMP', 'time', 'timestamptz']) {
      expect(getTypeColor(t)).toBe('accent.secondary');
    }
  });

  it('boolean → accent.success', () => {
    expect(getTypeColor('BOOLEAN')).toBe('accent.success');
    expect(getTypeColor('bool')).toBe('accent.success');
  });

  it('case-insensitive', () => {
    expect(getTypeColor('bigint')).toBe('accent.teal');
    expect(getTypeColor('BigInt')).toBe('accent.teal');
  });

  it('unrecognized → fg.muted (preserves the existing quirk: bare DOUBLE is not teal)', () => {
    // DOUBLE contains none of int/number/decimal/float — matches the current
    // behavior exactly, so tables render unchanged after the extraction.
    expect(getTypeColor('DOUBLE')).toBe('fg.muted');
    expect(getTypeColor('JSON')).toBe('fg.muted');
    expect(getTypeColor('')).toBe('fg.muted');
  });
});
