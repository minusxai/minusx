import { describe, it, expect } from 'vitest'
import { CHART_COLORS, COLOR_PALETTE, getEffectiveColorPalette, resolveSeriesColor } from '@/lib/chart/echarts-theme'

describe('resolveSeriesColor', () => {
  it('resolves a known color key to its hex', () => {
    expect(resolveSeriesColor('danger')).toBe(CHART_COLORS.danger)
  })

  it('returns a raw 6-digit hex as-is', () => {
    expect(resolveSeriesColor('#7c3aed')).toBe('#7c3aed')
  })

  it('returns a raw 3-digit hex as-is', () => {
    expect(resolveSeriesColor('#abc')).toBe('#abc')
  })

  it('returns undefined for an unknown non-hex value', () => {
    expect(resolveSeriesColor('not-a-color')).toBeUndefined()
  })

  it('returns undefined for empty/nullish input', () => {
    expect(resolveSeriesColor('')).toBeUndefined()
    expect(resolveSeriesColor(undefined)).toBeUndefined()
    expect(resolveSeriesColor(null)).toBeUndefined()
  })
})

describe('getEffectiveColorPalette', () => {
  it('applies a raw hex override at the given index', () => {
    const palette = getEffectiveColorPalette({ '0': '#7c3aed' })
    expect(palette[0]).toBe('#7c3aed')
    expect(palette[1]).toBe(COLOR_PALETTE[1])
  })

  it('applies a known color-key override at the given index', () => {
    const palette = getEffectiveColorPalette({ '2': 'danger' })
    expect(palette[2]).toBe(CHART_COLORS.danger)
  })

  it('supports a mix of hex and key overrides', () => {
    const palette = getEffectiveColorPalette({ '0': '#123456', '1': 'warning' })
    expect(palette[0]).toBe('#123456')
    expect(palette[1]).toBe(CHART_COLORS.warning)
  })

  it('ignores unresolvable override values', () => {
    const palette = getEffectiveColorPalette({ '0': 'bogus' })
    expect(palette[0]).toBe(COLOR_PALETTE[0])
  })

  it('returns the base palette unchanged when no overrides', () => {
    expect(getEffectiveColorPalette()).toEqual(COLOR_PALETTE)
    expect(getEffectiveColorPalette({})).toEqual(COLOR_PALETTE)
  })
})
