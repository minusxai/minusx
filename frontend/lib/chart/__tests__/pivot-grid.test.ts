/**
 * Pure pivot grid-layout engine (lib/chart/pivot-grid.ts) — the header trees,
 * display rows (data/subtotal/formula), collapse filtering, row spans, and
 * heatmap domain that PivotTable.tsx previously computed inside component memos.
 *
 * Fixtures run through the REAL aggregation engine (aggregatePivotData /
 * computeFormulas) so these tests characterize the actual shapes the component
 * renders, not synthetic ones.
 */
import { describe, it, expect } from 'vitest'
import { aggregatePivotData, computeFormulas } from '../pivot-utils'
import type { PivotConfig } from '@/lib/types'
import {
  buildColumnEntries,
  buildColHeaderRows,
  buildDisplayRows,
  filterVisibleRows,
  buildRowSpans,
  computeHeatmapDomain,
  makeGroupKey,
  type PivotDisplayRow,
} from '../pivot-grid'

const ROWS = [
  { region: 'West', product: 'A', month: 'Jan', revenue: 100 },
  { region: 'West', product: 'B', month: 'Jan', revenue: 50 },
  { region: 'West', product: 'A', month: 'Feb', revenue: 150 },
  { region: 'East', product: 'A', month: 'Jan', revenue: 200 },
]

const CONFIG: PivotConfig = {
  rows: ['region', 'product'],
  columns: ['month'],
  values: [{ column: 'revenue', aggFunction: 'SUM' }],
}

// Sorted: rowHeaders = [[East,A],[West,A],[West,B]]; columnHeaders = [[Feb],[Jan]]
const data = () => aggregatePivotData(ROWS, CONFIG)
const identityFmt = (v: string) => v

describe('buildColumnEntries', () => {
  it('one data entry per cell column when there are no column formulas', () => {
    const entries = buildColumnEntries(data(), null)
    expect(entries).toEqual([
      { type: 'data', cellIndex: 0 },
      { type: 'data', cellIndex: 1 },
    ])
  })

  it('interleaves formula columns after their insertion colKey', () => {
    const config: PivotConfig = {
      ...CONFIG,
      columnFormulas: [{ name: 'Δ', operandA: 'Jan', operandB: 'Feb', operator: '-' }],
    }
    const pd = aggregatePivotData(ROWS, config)
    const fr = computeFormulas(pd, config)
    const entries = buildColumnEntries(pd, fr)
    // Feb (ck 0), Jan (ck 1), then the formula after Jan
    expect(entries).toEqual([
      { type: 'data', cellIndex: 0 },
      { type: 'data', cellIndex: 1 },
      { type: 'formula-col', formulaIdx: 0, valueIdx: 0 },
    ])
  })
})

describe('buildColHeaderRows', () => {
  it('single value: one header row, one cell per colKey, colSpan 1', () => {
    const rows = buildColHeaderRows(data(), null, identityFmt, ['month'])
    expect(rows).toHaveLength(1)
    expect(rows[0].map(h => h.label)).toEqual(['Feb', 'Jan'])
    expect(rows[0].every(h => h.colSpan === 1)).toBe(true)
  })

  it('formats header labels through fmtHeader with the dimension name', () => {
    const rows = buildColHeaderRows(data(), null, (v, dim) => `${dim}:${v}`, ['month'])
    expect(rows[0].map(h => h.label)).toEqual(['month:Feb', 'month:Jan'])
  })

  it('multiple values: appends a value-label row and colSpans widen', () => {
    const config: PivotConfig = {
      ...CONFIG,
      values: [
        { column: 'revenue', aggFunction: 'SUM' },
        { column: 'revenue', aggFunction: 'AVG' },
      ],
    }
    const pd = aggregatePivotData(ROWS, config)
    const rows = buildColHeaderRows(pd, null, identityFmt, ['month'])
    expect(rows).toHaveLength(2)
    expect(rows[0].map(h => h.colSpan)).toEqual([2, 2])
    expect(rows[1].map(h => h.label)).toEqual([
      'SUM(revenue)', 'AVG(revenue)', 'SUM(revenue)', 'AVG(revenue)',
    ])
  })

  it('column formulas get a header cell spanning all header rows', () => {
    const config: PivotConfig = {
      ...CONFIG,
      columnFormulas: [{ name: 'Δ', operandA: 'Jan', operandB: 'Feb', operator: '-' }],
    }
    const pd = aggregatePivotData(ROWS, config)
    const fr = computeFormulas(pd, config)
    const rows = buildColHeaderRows(pd, fr, identityFmt, ['month'])
    const formulaCell = rows[0].find(h => h.isFormula)
    expect(formulaCell?.label).toBe('Δ')
  })
})

describe('buildDisplayRows', () => {
  it('inserts a level-0 subtotal after each top-level group (2 row dims)', () => {
    const rows = buildDisplayRows(data(), null)
    expect(rows.map(r => r.type)).toEqual(['data', 'subtotal', 'data', 'data', 'subtotal'])
    const sub = rows[1] as Extract<PivotDisplayRow, { type: 'subtotal' }>
    expect(sub.label).toBe('East Total')
    expect(sub.level).toBe(0)
    expect(sub.cells).toEqual([0, 200]) // Feb, Jan for East
    const westSub = rows[4] as Extract<PivotDisplayRow, { type: 'subtotal' }>
    expect(westSub.label).toBe('West Total')
    expect(westSub.cells).toEqual([150, 150])
  })

  it('no subtotals with a single row dimension', () => {
    const config: PivotConfig = { ...CONFIG, rows: ['region'] }
    const pd = aggregatePivotData(ROWS, config)
    const rows = buildDisplayRows(pd, null)
    expect(rows.map(r => r.type)).toEqual(['data', 'data'])
  })

  it('places a row formula after the last operand data row', () => {
    const config: PivotConfig = {
      ...CONFIG,
      rowFormulas: [{ name: 'W-E', operandA: 'West', operandB: 'East', operator: '-' }],
    }
    const pd = aggregatePivotData(ROWS, config)
    const fr = computeFormulas(pd, config)
    const rows = buildDisplayRows(pd, fr)
    const idx = rows.findIndex(r => r.type === 'formula-row')
    expect(idx).toBeGreaterThan(-1)
    const formula = rows[idx] as Extract<PivotDisplayRow, { type: 'formula-row' }>
    expect(formula.name).toBe('W-E')
    // West group total 300, East 200 → [150-0, 150-200]
    expect(formula.cells).toEqual([150, -50])
    // Lands directly after the last West data row (before the West subtotal)
    expect(rows[idx - 1].type).toBe('data')
  })
})

describe('filterVisibleRows', () => {
  it('collapsing a group hides its data rows but keeps the subtotal', () => {
    const pd = data()
    const displayRows = buildDisplayRows(pd, null)
    const collapsed = new Set([makeGroupKey(['West'])])
    const visible = filterVisibleRows(displayRows, pd, collapsed, true)
    // East data + East subtotal + West subtotal (West data rows hidden)
    expect(visible.map(r => r.type)).toEqual(['data', 'subtotal', 'subtotal'])
  })

  it('showColTotals=false removes subtotal rows entirely', () => {
    const pd = data()
    const displayRows = buildDisplayRows(pd, null)
    const visible = filterVisibleRows(displayRows, pd, new Set(), false)
    expect(visible.every(r => r.type === 'data')).toBe(true)
  })
})

describe('buildRowSpans', () => {
  it('merges repeated level-0 values across their group rows', () => {
    const pd = data()
    const visible = filterVisibleRows(buildDisplayRows(pd, null), pd, new Set(), true)
    const spans = buildRowSpans(visible, pd.rowHeaders, 2)
    // visible: [data East/A, subtotal, data West/A, data West/B, subtotal]
    expect(spans[0][0]).toEqual({ show: true, rowSpan: 1 })
    expect(spans[2][0]).toEqual({ show: true, rowSpan: 2 }) // West spans its 2 rows
    expect(spans[3][0].show).toBe(false)
    // Subtotal rows never show dimension cells
    expect(spans[1][0].show).toBe(false)
    expect(spans[4][0].show).toBe(false)
  })
})

describe('computeHeatmapDomain', () => {
  it('excludes absent cells from the min/max domain', () => {
    const pd = data()
    // East/Feb and West-B/Feb are absent (no source rows) — their 0s must not
    // drag the min down; true min is 50 (West/B Jan).
    const { minValue, maxValue } = computeHeatmapDomain(pd)
    expect(minValue).toBe(50)
    expect(maxValue).toBe(200)
  })
})

describe('buildPivotCellBg', () => {
  // Same fixture: rowHeaders [[East,A],[West,A],[West,B]], columnHeaders [Feb, Jan]
  // Present values: East/Jan 200, West-A/Feb 150, West-A/Jan 100, West-B/Jan 50.
  const pd = () => aggregatePivotData(ROWS, CONFIG)

  it('scale rule ramps min→max over the value column, skipping absent cells', async () => {
    const { buildPivotCellBg } = await import('../pivot-grid')
    const { getScaleColor } = await import('../color-scale')
    const getBg = buildPivotCellBg(
      [{ id: 's', column: 'revenue', scale: 'red-yellow-green' }], pd(), ['revenue'])
    expect(getBg(0, 1)).toBe(getScaleColor(1, 'red-yellow-green', false, 0.55))    // 200 = max
    expect(getBg(2, 1)).toBe(getScaleColor(0, 'red-yellow-green', false, 0.55))    // 50 = min
    expect(getBg(0, 0)).toBeUndefined()                                            // absent cell
  })

  it('cell-target condition paints only matching cells', async () => {
    const { buildPivotCellBg } = await import('../pivot-grid')
    const getBg = buildPivotCellBg(
      [{ id: 'c', column: 'revenue', operator: '>', value: '150', target: 'cell', bgColor: '#123456' }],
      pd(), ['revenue'])
    expect(getBg(0, 1)).toBe('#123456')  // 200 > 150
    expect(getBg(1, 0)).toBeUndefined()  // 150 not > 150
  })

  it('row-target condition paints the whole matching row', async () => {
    const { buildPivotCellBg } = await import('../pivot-grid')
    const getBg = buildPivotCellBg(
      [{ id: 'r', column: 'revenue', operator: '>', value: '150', target: 'row', bgColor: '#ff0000' }],
      pd(), ['revenue'])
    expect(getBg(0, 0)).toBe('#ff0000')
    expect(getBg(0, 1)).toBe('#ff0000')
    expect(getBg(1, 1)).toBeUndefined()
  })

  it('rules referencing unknown columns never paint', async () => {
    const { buildPivotCellBg } = await import('../pivot-grid')
    const getBg = buildPivotCellBg(
      [{ id: 's', column: 'nope', scale: 'green' }], pd(), ['revenue'])
    expect(getBg(0, 1)).toBeUndefined()
  })
})
