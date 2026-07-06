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
import type { ConditionalFormatRule } from '@/lib/types'
import type { TestOperator } from '@/lib/types'

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
export function evalCondition(value: unknown, rule: ConditionalFormatRule, columnType: ColumnType): boolean {
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
): (row: Record<string, unknown>, colId: string) => string | undefined {
  if (!rules || rules.length === 0) return () => undefined

  // Precompute which column-target rules have at least one matching row.
  const columnMatch = new Map<string, boolean>()
  for (const rule of rules) {
    if (rule.target !== 'column') continue
    const ct = columnTypeByName[rule.column] ?? 'text'
    columnMatch.set(rule.id, rows.some(row => evalCondition(row[rule.column], rule, ct)))
  }

  return (row, colId) => {
    let bg: string | undefined
    for (const rule of rules) {
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
