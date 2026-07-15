/**
 * Pure pivot grid-layout engine — RFC §10's "pure data engine" half of the
 * pivot split. Converts PivotData (+ FormulaResults + collapse state) into the
 * presentational structures a grid renders: column entries, nested header
 * rows, display rows (data/subtotal/formula), visible-row filtering, row-header
 * spans, and the heatmap colour domain.
 *
 * Extracted verbatim from PivotTable.tsx's in-component memos (code motion —
 * no logic change) so the layout is unit-testable and reusable by any grid
 * presentation layer.
 */
import type { PivotData, FormulaResults } from './pivot-utils'
import type { ConditionalFormatRule } from '@/lib/validation/atlas-schemas'
import { evalCondition, isColorScaleRule } from './conditional-format-utils'
import { getScaleColor } from './color-scale'

export type PivotDisplayRow =
  | { type: 'data'; rowIndex: number }
  | { type: 'subtotal'; level: number; label: string; cells: number[]; rowTotal: number; groupValues: string[] }
  | { type: 'formula-row'; name: string; cells: number[]; rowTotal: number; dimensionLevel?: number; parentValues?: string[] }

export type PivotColEntry =
  | { type: 'data'; cellIndex: number }
  | { type: 'formula-col'; formulaIdx: number; valueIdx: number }

export interface PivotHeaderCell {
  label: string
  colSpan: number
  rowSpan?: number
  isFormula?: boolean
}

export interface PivotRowSpan {
  show: boolean
  rowSpan: number
}

/** Header-label formatter: (raw dimension value, dimension name) → display label. */
export type PivotHeaderFormatter = (value: string, dimName?: string) => string

/** Group-key encoding shared by collapse state, subtotal rows, and formula scoping. */
export const makeGroupKey = (values: string[]): string => values.join('|||')

const numValuesOf = (pivotData: PivotData): number => pivotData.valueLabels.length || 1

/** Column entries: regular data columns interleaved with formula columns. */
export function buildColumnEntries(
  pivotData: PivotData,
  formulaResults: FormulaResults | null | undefined,
): PivotColEntry[] {
  const { cells, columnHeaders } = pivotData
  const numValues = numValuesOf(pivotData)
  const numDataCols = cells.length > 0 ? cells[0].length : 0
  const colFormulas = formulaResults?.columnFormulas ?? []
  if (numDataCols === 0) return []
  if (colFormulas.length === 0) {
    return Array.from({ length: numDataCols }, (_, i) => ({ type: 'data' as const, cellIndex: i }))
  }

  const entries: PivotColEntry[] = []
  const formulasByInsertCK = new Map<number, number[]>()
  for (let fi = 0; fi < colFormulas.length; fi++) {
    const ck = colFormulas[fi].insertAfterColKeyIndex
    if (!formulasByInsertCK.has(ck)) formulasByInsertCK.set(ck, [])
    formulasByInsertCK.get(ck)!.push(fi)
  }

  for (let ck = 0; ck < columnHeaders.length; ck++) {
    for (let vi = 0; vi < numValues; vi++) {
      entries.push({ type: 'data', cellIndex: ck * numValues + vi })
    }
    const formulas = formulasByInsertCK.get(ck)
    if (formulas) {
      for (const fi of formulas) {
        for (let vi = 0; vi < numValues; vi++) {
          entries.push({ type: 'formula-col', formulaIdx: fi, valueIdx: vi })
        }
      }
    }
  }

  return entries
}

/** Nested column header rows (with colSpans), augmented with formula column headers. */
export function buildColHeaderRows(
  pivotData: PivotData,
  formulaResults: FormulaResults | null | undefined,
  fmtHeader: PivotHeaderFormatter,
  colDimNames?: string[],
): PivotHeaderCell[][] {
  const { columnHeaders, valueLabels } = pivotData
  if (columnHeaders.length === 0) return []
  const numValues = numValuesOf(pivotData)
  const hasMultipleValues = valueLabels.length > 1
  const numColDims = columnHeaders[0].length
  const colFormulas = formulaResults?.columnFormulas ?? []

  // Build base header rows
  const baseRows: Array<Array<{ label: string; colSpan: number }>> = []
  for (let level = 0; level < numColDims; level++) {
    const headerRow: Array<{ label: string; colSpan: number }> = []
    let i = 0
    while (i < columnHeaders.length) {
      const rawLabel = columnHeaders[i][level]
      const currentLabel = fmtHeader(rawLabel, colDimNames?.[level])
      let span = 1
      while (i + span < columnHeaders.length) {
        const matches = columnHeaders[i + span][level] === rawLabel
        let parentsMatch = true
        for (let p = 0; p < level; p++) {
          if (columnHeaders[i + span][p] !== columnHeaders[i][p]) {
            parentsMatch = false
            break
          }
        }
        if (matches && parentsMatch) span++
        else break
      }
      const effectiveSpan = hasMultipleValues ? span * numValues : span
      headerRow.push({ label: currentLabel, colSpan: effectiveSpan })
      i += span
    }
    baseRows.push(headerRow)
  }
  if (hasMultipleValues) {
    const valueRow: Array<{ label: string; colSpan: number }> = []
    for (let c = 0; c < columnHeaders.length; c++) {
      for (const vl of valueLabels) {
        valueRow.push({ label: vl, colSpan: 1 })
      }
    }
    baseRows.push(valueRow)
  }

  // If no column formulas, return base rows as PivotHeaderCell
  if (colFormulas.length === 0) {
    return baseRows.map(row => row.map(h => ({ label: h.label, colSpan: h.colSpan })))
  }

  // Determine level-0 group ranges (colKey ranges)
  const level0Groups: { label: string; startCK: number; endCK: number }[] = []
  {
    let ck = 0
    while (ck < columnHeaders.length) {
      const start = ck
      const label = columnHeaders[ck][0]
      while (ck + 1 < columnHeaders.length && columnHeaders[ck + 1][0] === label) ck++
      level0Groups.push({ label, startCK: start, endCK: ck })
      ck++
    }
  }

  // Map formulas to level-0 groups they insert after
  const formulasAfterGroup = new Map<number, number[]>()
  for (let fi = 0; fi < colFormulas.length; fi++) {
    const insertCK = colFormulas[fi].insertAfterColKeyIndex
    for (let g = 0; g < level0Groups.length; g++) {
      if (insertCK >= level0Groups[g].startCK && insertCK <= level0Groups[g].endCK) {
        if (!formulasAfterGroup.has(g)) formulasAfterGroup.set(g, [])
        formulasAfterGroup.get(g)!.push(fi)
        break
      }
    }
  }

  // Build augmented header rows
  const result: PivotHeaderCell[][] = []
  for (let level = 0; level < baseRows.length; level++) {
    const isValueLevel = hasMultipleValues && level === baseRows.length - 1

    if (level === 0) {
      const augRow: PivotHeaderCell[] = []
      for (let g = 0; g < level0Groups.length; g++) {
        augRow.push({ label: baseRows[0][g].label, colSpan: baseRows[0][g].colSpan })
        const formulas = formulasAfterGroup.get(g)
        if (formulas) {
          for (const fi of formulas) {
            augRow.push({
              label: colFormulas[fi].name,
              colSpan: hasMultipleValues ? numValues : 1,
              rowSpan: numColDims,
              isFormula: true,
            })
          }
        }
      }
      result.push(augRow)
    } else if (isValueLevel) {
      // Value level: regular value labels + formula value labels
      const augRow: PivotHeaderCell[] = []
      for (let g = 0; g < level0Groups.length; g++) {
        const numCKs = level0Groups[g].endCK - level0Groups[g].startCK + 1
        for (let ck = 0; ck < numCKs; ck++) {
          for (const vl of valueLabels) {
            augRow.push({ label: vl, colSpan: 1 })
          }
        }
        const formulas = formulasAfterGroup.get(g)
        if (formulas) {
          for (const _fi of formulas) {
            for (const vl of valueLabels) {
              augRow.push({ label: vl, colSpan: 1, isFormula: true })
            }
          }
        }
      }
      result.push(augRow)
    } else {
      // Intermediate dim levels: regular headers only (formula cols covered by rowSpan)
      result.push(baseRows[level].map(h => ({ label: h.label, colSpan: h.colSpan })))
    }
  }

  return result
}

/** Display rows: data rows + subtotal rows + formula rows, in render order. */
export function buildDisplayRows(
  pivotData: PivotData,
  formulaResults: FormulaResults | null | undefined,
): PivotDisplayRow[] {
  const { rowHeaders, cells, rowTotals } = pivotData
  const numRowDims = rowHeaders.length > 0 ? rowHeaders[0].length : 0
  const numDataCols = cells.length > 0 ? cells[0].length : 0

  if (rowHeaders.length === 0) {
    const result: PivotDisplayRow[] = cells.map((_, i) => ({ type: 'data' as const, rowIndex: i }))
    // Insert formula rows at end if applicable
    const rowFormulas = formulaResults?.rowFormulas ?? []
    for (const rf of rowFormulas) {
      result.push({ type: 'formula-row', name: rf.name, cells: rf.cells, rowTotal: rf.rowTotal })
    }
    return result
  }

  // Build data + subtotal rows
  const result: PivotDisplayRow[] = []

  if (numRowDims < 2) {
    // No subtotals for single dim
    for (let i = 0; i < rowHeaders.length; i++) {
      result.push({ type: 'data', rowIndex: i })
    }
  } else {
    for (let i = 0; i < rowHeaders.length; i++) {
      result.push({ type: 'data', rowIndex: i })

      for (let level = numRowDims - 2; level >= 0; level--) {
        const isLastRow = i === rowHeaders.length - 1
        const groupChanges = !isLastRow && (
          rowHeaders[i][level] !== rowHeaders[i + 1][level] ||
          (() => {
            for (let p = 0; p < level; p++) {
              if (rowHeaders[i][p] !== rowHeaders[i + 1][p]) return true
            }
            return false
          })()
        )

        if (isLastRow || groupChanges) {
          let groupStart = i
          while (groupStart > 0) {
            let sameGroup = true
            for (let p = 0; p <= level; p++) {
              if (rowHeaders[groupStart - 1][p] !== rowHeaders[i][p]) {
                sameGroup = false
                break
              }
            }
            if (sameGroup) groupStart--
            else break
          }

          const subtotalCells = new Array(numDataCols).fill(0)
          let subtotalRowTotal = 0
          for (let r = groupStart; r <= i; r++) {
            for (let c = 0; c < numDataCols; c++) {
              subtotalCells[c] += cells[r][c]
            }
            subtotalRowTotal += rowTotals[r]
          }

          result.push({
            type: 'subtotal',
            level,
            label: rowHeaders[i][level] + ' Total',
            cells: subtotalCells,
            rowTotal: subtotalRowTotal,
            groupValues: rowHeaders[i].slice(0, level + 1),
          })
        }
      }
    }
  }

  // Insert formula rows one at a time, in order. Each formula lands after
  // the last of its operands (data row or prior formula row).
  const rowFormulas = formulaResults?.rowFormulas ?? []
  for (const rf of rowFormulas) {
    const dimLevel = rf.dimensionLevel ?? 0
    const targetRowIndex = rf.insertAfterRowIndex

    let insertPosition = -1

    // Find the data row for the last operand
    for (let d = 0; d < result.length; d++) {
      const dr = result[d]
      if (dr.type === 'data' && dr.rowIndex === targetRowIndex) {
        insertPosition = d + 1
        break
      }
    }

    // Advance past any formula rows already inserted at this position
    // (from prior formulas in the chain). This ensures chained formulas
    // appear AFTER their formula operands, not before them.
    if (insertPosition !== -1) {
      while (insertPosition < result.length && result[insertPosition].type === 'formula-row') {
        insertPosition++
      }
    }

    // Fallback for sub-group: before parent subtotal
    if (insertPosition === -1 && dimLevel > 0 && rf.parentValues && rf.parentValues.length > 0) {
      const parentLevel = dimLevel - 1
      for (let d = 0; d < result.length; d++) {
        const dr = result[d]
        if (dr.type === 'subtotal' && dr.level === parentLevel) {
          let matches = true
          for (let p = 0; p <= parentLevel; p++) {
            if (dr.groupValues[p] !== rf.parentValues![p]) { matches = false; break }
          }
          if (matches) { insertPosition = d; break }
        }
      }
    }

    // Fallback for top-level: after level-0 subtotal
    if (insertPosition === -1 && dimLevel === 0) {
      const topLevelValue = rowHeaders[targetRowIndex]?.[0]
      if (topLevelValue) {
        for (let d = 0; d < result.length; d++) {
          const dr = result[d]
          if (dr.type === 'subtotal' && dr.level === 0 && dr.groupValues[0] === topLevelValue) {
            insertPosition = d + 1
            break
          }
        }
      }
    }

    if (insertPosition === -1) insertPosition = result.length

    result.splice(insertPosition, 0, {
      type: 'formula-row', name: rf.name, cells: rf.cells, rowTotal: rf.rowTotal, dimensionLevel: dimLevel, parentValues: rf.parentValues,
    })
  }

  return result
}

/** Filter display rows against collapsed groups and the column-totals toggle. */
export function filterVisibleRows(
  displayRows: PivotDisplayRow[],
  pivotData: PivotData,
  collapsedGroups: Set<string>,
  showColTotals: boolean,
): PivotDisplayRow[] {
  const { rowHeaders } = pivotData
  const numRowDims = rowHeaders.length > 0 ? rowHeaders[0].length : 0

  return displayRows.filter(dr => {
    if (dr.type === 'formula-row') {
      // Sub-group formula rows should be hidden when parent group is collapsed
      if (dr.parentValues && dr.parentValues.length > 0) {
        for (let level = 0; level < dr.parentValues.length; level++) {
          const key = makeGroupKey(dr.parentValues.slice(0, level + 1))
          if (collapsedGroups.has(key)) return false
        }
      }
      return true
    }

    if (dr.type === 'subtotal') {
      if (!showColTotals) return false
      for (let parentLevel = 0; parentLevel < dr.level; parentLevel++) {
        const parentKey = makeGroupKey(dr.groupValues.slice(0, parentLevel + 1))
        if (collapsedGroups.has(parentKey)) return false
      }
      return true
    }

    if (dr.type === 'data') {
      for (let level = 0; level < numRowDims - 1; level++) {
        const key = makeGroupKey(rowHeaders[dr.rowIndex].slice(0, level + 1))
        if (collapsedGroups.has(key)) return false
      }
      return true
    }

    return true
  })
}

/** Row-header spans for nested grouping, computed over the VISIBLE rows. */
export function buildRowSpans(
  visibleRows: PivotDisplayRow[],
  rowHeaders: string[][],
  numRowDims: number,
): PivotRowSpan[][] {
  if (rowHeaders.length === 0 || numRowDims === 0) return []

  const spans: PivotRowSpan[][] = visibleRows.map(() =>
    Array.from({ length: numRowDims }, () => ({ show: true, rowSpan: 1 }))
  )

  for (let level = 0; level < numRowDims; level++) {
    let i = 0
    while (i < visibleRows.length) {
      const dr = visibleRows[i]

      // Formula rows and subtotals don't participate in dimension grouping
      if (dr.type === 'subtotal' || dr.type === 'formula-row') {
        spans[i][level] = { show: false, rowSpan: 1 }
        i++
        continue
      }

      // Data row: count span including subtotals at levels STRICTLY GREATER than this level
      let span = 1
      while (i + span < visibleRows.length) {
        const next = visibleRows[i + span]
        if (next.type === 'formula-row') {
          // Sub-level formula rows don't break parent-level spans
          const formulaLevel = next.dimensionLevel ?? 0
          if (formulaLevel > level) {
            span++
            continue
          }
          break
        }
        if (next.type === 'subtotal') {
          if (next.level > level) {
            span++
            continue
          }
          break
        }
        const matches = rowHeaders[next.rowIndex][level] === rowHeaders[dr.rowIndex][level]
        let parentsMatch = true
        for (let p = 0; p < level; p++) {
          if (rowHeaders[next.rowIndex][p] !== rowHeaders[dr.rowIndex][p]) {
            parentsMatch = false
            break
          }
        }
        if (matches && parentsMatch) span++
        else break
      }

      spans[i][level] = { show: true, rowSpan: span }
      for (let j = 1; j < span; j++) {
        spans[i + j][level] = { show: false, rowSpan: 1 }
      }
      i += span
    }
  }

  return spans
}

/** Alpha for scale-rule cell fills — matches the flat table and the pivot heatmap. */
const SCALE_ALPHA = 0.55

/**
 * Conditional background for pivot DATA cells — the pivot-shaped equivalent of
 * the flat table's buildConditionalBg, sharing the exact same rule vocabulary.
 * Rules reference VALUE columns by result column name; a rule applies to every
 * leaf cell of that value column across the cross-tab:
 *   - colour-scale rules ramp min→max over the value column's present cells
 *   - 'cell' paints a leaf cell when its own value matches
 *   - 'column' paints all the value column's cells when any cell matches
 *   - 'row' paints the whole row when any of the value column's cells in it match
 * Rules apply in array order, last match wins. Subtotal/formula rows are
 * outside the cells matrix and keep their accent styling.
 */
export function buildPivotCellBg(
  rules: ConditionalFormatRule[] | undefined,
  pivotData: PivotData,
  valueColumns: string[] | undefined,
  opts?: { isDark?: boolean },
): (rowIndex: number, cellIndex: number) => string | undefined {
  if (!rules || rules.length === 0 || !valueColumns || valueColumns.length === 0) {
    return () => undefined
  }
  const { cells, cellPresent } = pivotData
  const isDark = opts?.isDark ?? false
  const numValues = valueColumns.length
  const isPresent = (r: number, c: number) => cellPresent?.[r]?.[c] ?? true

  // Per rule: which value indices it targets (a value column can repeat).
  const applicableValueIdx = (column: string): Set<number> => {
    const set = new Set<number>()
    valueColumns.forEach((name, i) => { if (name === column) set.add(i) })
    return set
  }
  const cellApplies = (targets: Set<number>, cellIndex: number) => targets.has(cellIndex % numValues)

  interface CompiledRule {
    rule: ConditionalFormatRule
    targets: Set<number>
    domain?: { min: number; max: number }      // scale rules
    columnMatch?: boolean                       // 'column' target: any cell matched
    rowMatch?: boolean[]                        // 'row' target: per-row any-match
  }

  const compiled: CompiledRule[] = rules.map(rule => {
    const targets = applicableValueIdx(rule.column)
    const entry: CompiledRule = { rule, targets }
    if (targets.size === 0) return entry
    if (isColorScaleRule(rule)) {
      let min = Infinity
      let max = -Infinity
      for (let r = 0; r < cells.length; r++) {
        for (let c = 0; c < cells[r].length; c++) {
          if (!cellApplies(targets, c) || !isPresent(r, c)) continue
          const v = cells[r][c]
          if (v < min) min = v
          if (v > max) max = v
        }
      }
      if (min !== Infinity) entry.domain = { min, max }
      return entry
    }
    if (rule.target === 'column') {
      entry.columnMatch = cells.some((row, r) =>
        row.some((v, c) => cellApplies(targets, c) && isPresent(r, c) && evalCondition(v, rule, 'number')))
    } else if (rule.target === 'row') {
      entry.rowMatch = cells.map((row, r) =>
        row.some((v, c) => cellApplies(targets, c) && isPresent(r, c) && evalCondition(v, rule, 'number')))
    }
    return entry
  })

  return (rowIndex, cellIndex) => {
    let bg: string | undefined
    for (const { rule, targets, domain, columnMatch, rowMatch } of compiled) {
      if (targets.size === 0) continue
      if (isColorScaleRule(rule)) {
        if (!cellApplies(targets, cellIndex) || !domain || !isPresent(rowIndex, cellIndex)) continue
        const v = cells[rowIndex][cellIndex]
        const normalized = domain.max === domain.min ? 0.5 : (v - domain.min) / (domain.max - domain.min)
        bg = getScaleColor(normalized, rule.scale, isDark, SCALE_ALPHA)
        continue
      }
      if (rule.target === 'row') {
        if (rowMatch?.[rowIndex]) bg = rule.bgColor
      } else if (rule.target === 'column') {
        if (cellApplies(targets, cellIndex) && columnMatch) bg = rule.bgColor
      } else if (cellApplies(targets, cellIndex) && isPresent(rowIndex, cellIndex)
          && evalCondition(cells[rowIndex][cellIndex], rule, 'number')) {
        bg = rule.bgColor
      }
    }
    return bg
  }
}

/**
 * Heatmap colour domain: min/max across PRESENT cells only (a missing cell is
 * N/A, not 0, and must not drag the domain down). Excludes formula cells,
 * which live outside the cells matrix.
 */
export function computeHeatmapDomain(pivotData: PivotData): { minValue: number; maxValue: number } {
  const { cells, cellPresent } = pivotData
  let min = Infinity
  let max = -Infinity
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      if (!(cellPresent?.[r]?.[c] ?? true)) continue
      const val = cells[r][c]
      if (val < min) min = val
      if (val > max) max = val
    }
  }
  return { minValue: min, maxValue: max }
}
