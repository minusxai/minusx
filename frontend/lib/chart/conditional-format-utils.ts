/**
 * Pure logic for table conditional background-color formatting.
 *
 * A rule has two independent axes:
 *   - condition: { column, operator, value } evaluated per row
 *   - target:    what gets painted when the condition matches —
 *                'cell' (the matching cell), 'row' (whole row), 'column' (whole column)
 *
 * Reuses `compareValues` (the same comparator alerts/tests use) for the shared
 * operators; `!=` and `contains` are handled locally so the shared function stays
 * untouched.
 */
import { compareValues } from '@/lib/evals/index'
import type { ColumnType } from '@/lib/database/column-types'
import type { ColorScaleFormatRule, ConditionFormatRule, ConditionalFormatRule } from '@/lib/types'
import type { TestOperator } from '@/lib/types'
import { getScaleColor } from './color-scale'

/** Alpha for scale-rule cell fills — matches the pivot heatmap's non-compact fill. */
const SCALE_ALPHA = 0.55

/** Discriminate the two ConditionalFormatRule variants. */
export const isColorScaleRule = (rule: ConditionalFormatRule): rule is ColorScaleFormatRule =>
  'scale' in rule

/**
 * Pick a readable text color (near-black or white) for a given hex background,
 * using sRGB relative luminance. Lets users choose only a bg color — the
 * foreground is derived automatically. Falls back to 'inherit' for bad input.
 */
export function getContrastText(bgHex: string): string {
  const c = bgHex.replace('#', '')
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c
  if (full.length !== 6) return 'inherit'
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 'inherit'
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff'
}

/** Evaluate a single rule's condition against a raw cell value. Null/undefined never match. */
export function evalCondition(value: unknown, rule: ConditionFormatRule, columnType: ColumnType): boolean {
  if (value == null) return false
  const answerType: 'number' | 'string' = columnType === 'number' ? 'number' : 'string'
  const { operator } = rule
  const expected = rule.value

  if (operator === 'contains') {
    return String(value).toLowerCase().includes(String(expected).toLowerCase())
  }
  if (operator === '!=') {
    return !compareValues(value as string | number, expected, '=', answerType)
  }
  // '=', '>', '<', '>=', '<=' — delegate to the shared comparator
  return compareValues(value as string | number, expected, operator as TestOperator, answerType)
}

/**
 * Build a fast per-cell lookup `(row, colId) => bgColor | undefined`.
 * Column-target "any row matches" is precomputed once; row/cell targets evaluate
 * against the supplied row. Rules apply in array order, last match wins.
 */
export function buildConditionalBg(
  rules: ConditionalFormatRule[] | undefined,
  rows: Record<string, unknown>[],
  columnTypeByName: Record<string, ColumnType>,
  opts?: { isDark?: boolean },
): (row: Record<string, unknown>, colId: string) => string | undefined {
  if (!rules || rules.length === 0) return () => undefined
  const isDark = opts?.isDark ?? false

  // Precompute which column-target rules have at least one matching row.
  const columnMatch = new Map<string, boolean>()
  // Precompute per-rule value domains for colour-scale rules.
  const scaleDomain = new Map<string, { min: number; max: number }>()
  for (const rule of rules) {
    if (isColorScaleRule(rule)) {
      let min = Infinity
      let max = -Infinity
      for (const row of rows) {
        const v = row[rule.column]
        if (v == null) continue
        const n = Number(v)
        if (!Number.isFinite(n)) continue
        if (n < min) min = n
        if (n > max) max = n
      }
      if (min !== Infinity) scaleDomain.set(rule.id, { min, max })
      continue
    }
    if (rule.target !== 'column') continue
    const ct = columnTypeByName[rule.column] ?? 'text'
    columnMatch.set(rule.id, rows.some(row => evalCondition(row[rule.column], rule, ct)))
  }

  return (row, colId) => {
    let bg: string | undefined
    for (const rule of rules) {
      if (isColorScaleRule(rule)) {
        if (colId !== rule.column) continue
        const domain = scaleDomain.get(rule.id)
        const v = row[colId]
        if (!domain || v == null) continue
        const n = Number(v)
        if (!Number.isFinite(n)) continue
        // Constant column → mid-ramp (no divide-by-zero)
        const normalized = domain.max === domain.min ? 0.5 : (n - domain.min) / (domain.max - domain.min)
        bg = getScaleColor(normalized, rule.scale, isDark, SCALE_ALPHA)
        continue
      }
      const ct = columnTypeByName[rule.column] ?? 'text'
      if (rule.target === 'row') {
        if (evalCondition(row[rule.column], rule, ct)) bg = rule.bgColor
      } else if (rule.target === 'cell') {
        if (colId === rule.column && evalCondition(row[colId], rule, ct)) bg = rule.bgColor
      } else if (rule.target === 'column') {
        if (colId === rule.column && columnMatch.get(rule.id)) bg = rule.bgColor
      }
    }
    return bg
  }
}
