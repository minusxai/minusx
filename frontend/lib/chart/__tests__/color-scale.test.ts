/**
 * Color-scale conditional formatting — the min→max colour ramp generalized out
 * of the pivot heatmap so BOTH grids (flat table + pivot) share one vocabulary:
 *   - lib/chart/color-scale.ts: pure ramp math (getScaleColor)
 *   - ColorScaleFormatRule: schema variant of ConditionalFormatRule
 *   - buildConditionalBg: paints scale rules per-column over the row set
 */
import { describe, it, expect } from 'vitest'
import { getScaleColor, COLOR_SCALES } from '../color-scale'
import { buildConditionalBg, isColorScaleRule } from '../conditional-format-utils'
import type { ConditionalFormatRule } from '@/lib/types'

describe('getScaleColor', () => {
  it('returns rgba() strings honoring the alpha', () => {
    const c = getScaleColor(0.5, 'red-yellow-green', false, 0.55)
    expect(c).toMatch(/^rgba\(\d+, \d+, \d+, 0\.55\)$/)
  })

  it('red-yellow-green endpoints: red at 0, green at 1', () => {
    expect(getScaleColor(0, 'red-yellow-green', false, 1)).toBe('rgba(200, 60, 60, 1)')
    expect(getScaleColor(1, 'red-yellow-green', false, 1)).toBe('rgba(45, 160, 140, 1)')
  })

  it('dark and light mode ramps differ for single-hue scales', () => {
    expect(getScaleColor(0.8, 'green', true, 1)).not.toBe(getScaleColor(0.8, 'green', false, 1))
    expect(getScaleColor(0.8, 'blue', true, 1)).not.toBe(getScaleColor(0.8, 'blue', false, 1))
  })

  it('exposes the scale names for pickers', () => {
    expect(COLOR_SCALES).toEqual(['red-yellow-green', 'green', 'blue'])
  })
})

describe('isColorScaleRule', () => {
  it('discriminates scale rules from condition rules', () => {
    expect(isColorScaleRule({ id: '1', column: 'x', scale: 'green' })).toBe(true)
    expect(isColorScaleRule({ id: '1', column: 'x', operator: '=', value: 'a', target: 'cell', bgColor: '#fff' })).toBe(false)
  })
})

describe('buildConditionalBg — colorScale rules', () => {
  const rows = [
    { name: 'a', revenue: 0 },
    { name: 'b', revenue: 50 },
    { name: 'c', revenue: 100 },
    { name: 'd', revenue: null },
  ]
  const types = { name: 'text' as const, revenue: 'number' as const }
  const scaleRule: ConditionalFormatRule = { id: 's1', column: 'revenue', scale: 'red-yellow-green' }

  it('paints min→max along the ramp, only on the target column', () => {
    const getBg = buildConditionalBg([scaleRule], rows, types)
    expect(getBg(rows[0], 'revenue')).toBe(getScaleColor(0, 'red-yellow-green', false, 0.55))
    expect(getBg(rows[2], 'revenue')).toBe(getScaleColor(1, 'red-yellow-green', false, 0.55))
    expect(getBg(rows[1], 'revenue')).toBe(getScaleColor(0.5, 'red-yellow-green', false, 0.55))
    expect(getBg(rows[0], 'name')).toBeUndefined()
  })

  it('null cells are never painted', () => {
    const getBg = buildConditionalBg([scaleRule], rows, types)
    expect(getBg(rows[3], 'revenue')).toBeUndefined()
  })

  it('honors dark mode via opts', () => {
    const light = buildConditionalBg([{ ...scaleRule, scale: 'green' }], rows, types)
    const dark = buildConditionalBg([{ ...scaleRule, scale: 'green' }], rows, types, { isDark: true })
    expect(light(rows[2], 'revenue')).not.toBe(dark(rows[2], 'revenue'))
  })

  it('a constant column paints the mid-ramp colour (no divide-by-zero)', () => {
    const constRows = [{ revenue: 7 }, { revenue: 7 }]
    const getBg = buildConditionalBg([scaleRule], constRows, { revenue: 'number' })
    expect(getBg(constRows[0], 'revenue')).toBe(getScaleColor(0.5, 'red-yellow-green', false, 0.55))
  })

  it('later condition rules override earlier scale rules (last match wins)', () => {
    const conditionRule: ConditionalFormatRule = {
      id: 'c1', column: 'revenue', operator: '>', value: '90', target: 'cell', bgColor: '#123456',
    }
    const getBg = buildConditionalBg([scaleRule, conditionRule], rows, types)
    expect(getBg(rows[2], 'revenue')).toBe('#123456')
    expect(getBg(rows[0], 'revenue')).toBe(getScaleColor(0, 'red-yellow-green', false, 0.55))
  })

  it('condition-only rule sets still work unchanged (regression)', () => {
    const conditionRule: ConditionalFormatRule = {
      id: 'c1', column: 'name', operator: '=', value: 'a', target: 'row', bgColor: '#abcdef',
    }
    const getBg = buildConditionalBg([conditionRule], rows, types)
    expect(getBg(rows[0], 'revenue')).toBe('#abcdef')
    expect(getBg(rows[1], 'revenue')).toBeUndefined()
  })
})

describe('schema — ColorScaleFormatRule validates through the envelope validator', () => {
  it('a table envelope with a scale rule has no schema issues', async () => {
    const { validateVizEnvelope } = await import('@/lib/viz/validate')
    const envelope = {
      version: 2,
      source: {
        kind: 'table',
        columnFormats: null,
        conditionalFormats: [{ id: 's1', column: 'revenue', scale: 'green' }],
        css: null,
      },
    }
    const result = validateVizEnvelope(envelope, [{ name: 'revenue', kind: 'quantitative' }])
    expect(result.issues.filter(i => i.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
  })
})
