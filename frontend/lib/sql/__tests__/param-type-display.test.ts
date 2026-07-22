/**
 * getTypeColor must return CONCRETE CSS colors (Renderer_v2 Phase 5): its consumers interpolate
 * the value into raw CSS (`border-left: 3px solid ${...}`, `color-mix(in srgb, ${...} 20%, ...)`)
 * — a Chakra token string like 'accent.primary' is invalid there and silently drops the style.
 */
import { describe, it, expect } from 'vitest';
import { getTypeColor } from '@/lib/sql/param-type-display';

describe('getTypeColor', () => {
  it('returns a concrete hex color for every parameter type (valid in raw CSS)', () => {
    for (const t of ['number', 'date', 'text'] as const) {
      expect(getTypeColor(t)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('keeps the type→hue scheme: number=blue, date=purple, text=orange', () => {
    expect(getTypeColor('number')).toBe('#2980b9');
    expect(getTypeColor('date')).toBe('#9b59b6');
    expect(getTypeColor('text')).toBe('#f39c12');
  });
});
