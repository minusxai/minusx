'use client'

import { useState, useMemo, useCallback } from 'react'
import { Box, Table as ChakraTable, Icon } from '@chakra-ui/react'
import { Tooltip } from '@/components/ui/tooltip'
import { LuChevronUp, LuChevronRight, LuSquareFunction } from 'react-icons/lu'
import { formatLargeNumber, formatNumber, formatDateValue, applyPrefixSuffix } from '@/lib/chart/chart-utils'
import type { PivotData, FormulaResults } from '@/lib/chart/pivot-utils'
import { useAppSelector } from '@/store/hooks'
import type { ColumnFormatConfig } from '@/lib/types'

type HeatmapScale = 'red-yellow-green' | 'green' | 'blue'

interface PivotTableProps {
  pivotData: PivotData
  showRowTotals?: boolean
  showColTotals?: boolean
  showHeatmap?: boolean
  compact?: boolean
  heatmapScale?: HeatmapScale
  emptyMessage?: string
  rowDimNames?: string[]
  colDimNames?: string[]
  formulaResults?: FormulaResults | null
  onCellClick?: (filters: Record<string, string>, valueLabel: string, event: React.MouseEvent) => void
  columnFormats?: Record<string, ColumnFormatConfig>
  valueColumns?: string[]  // Actual column names for each value (maps value index → column name)
}

type DisplayRow =
  | { type: 'data'; rowIndex: number }
  | { type: 'subtotal'; level: number; label: string; cells: number[]; rowTotal: number; groupValues: string[] }
  | { type: 'formula-row'; name: string; cells: number[]; rowTotal: number; dimensionLevel?: number; parentValues?: string[] }

type ColEntry =
  | { type: 'data'; cellIndex: number }
  | { type: 'formula-col'; formulaIdx: number; valueIdx: number }

interface HeaderCell {
  label: string
  colSpan: number
  rowSpan?: number
  isFormula?: boolean
}

const makeGroupKey = (values: string[]) => values.join('|||')

export const PivotTable = ({
  pivotData,
  showRowTotals = false,
  showColTotals = true,
  showHeatmap = true,
  compact = false,
  heatmapScale = 'red-yellow-green',
  emptyMessage,
  rowDimNames,
  colDimNames,
  formulaResults,
  onCellClick,
  columnFormats,
  valueColumns,
}: PivotTableProps) => {
  const colorMode = useAppSelector((state) => state.ui.colorMode) as 'light' | 'dark'
  const isDark = colorMode === 'dark'
  const { rowHeaders, columnHeaders, cells, rowTotals, valueLabels } = pivotData

  // Format a numeric cell value using per-value-column decimal/prefix/suffix config
  // When valueIndex is omitted (totals), fall back to first value column's format
  const fmt = useCallback((value: number, valueIndex?: number): string => {
    if (columnFormats && valueColumns) {
      const idx = valueIndex !== undefined ? valueIndex % (valueColumns.length || 1) : 0
      const colName = valueColumns[idx]
      const cfg = colName ? columnFormats[colName] : undefined
      const dp = cfg?.decimalPoints
      const formatted = dp != null ? formatNumber(value, dp) : formatLargeNumber(value)
      return applyPrefixSuffix(formatted, cfg?.prefix, cfg?.suffix)
    }
    return formatLargeNumber(value)
  }, [columnFormats, valueColumns])

  // Format a header value (row or column) using date format config
  const fmtHeader = useCallback((value: string, dimName?: string): string => {
    if (!dimName || !columnFormats) return value
    const dateFormat = columnFormats[dimName]?.dateFormat
    if (dateFormat) return formatDateValue(value, dateFormat)
    return value
  }, [columnFormats])

  const hasMultipleValues = valueLabels.length > 1
  const numRowDims = rowHeaders.length > 0 ? rowHeaders[0].length : 0
  const numColDims = columnHeaders.length > 0 ? columnHeaders[0].length : 0
  const numDataCols = cells.length > 0 ? cells[0].length : 0
  const numValues = valueLabels.length || 1

  // Collapsed groups state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  // Compute min/max across regular cells only for heatmap (excludes formula cells)
  const { minValue, maxValue } = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const row of cells) {
      for (const val of row) {
        if (val < min) min = val
        if (val > max) max = val
      }
    }
    return { minValue: min, maxValue: max }
  }, [cells])

  const getCellBg = useCallback((value: number): string | undefined => {
    if (!showHeatmap) return undefined
    if (maxValue === minValue) return 'accent.teal/75'
    const normalized = (value - minValue) / (maxValue - minValue)
    const alpha = compact ? 0.85 : 0.55
    let r: number, g: number, b: number

    if (heatmapScale === 'green') {
      if (isDark) {
        // Dark mode green: near-black → #0e4429 → #26a641 → #4aea64
        if (normalized < 0.33) {
          const t = normalized / 0.33
          r = Math.round(5 + 9 * t); g = Math.round(10 + 58 * t); b = Math.round(5 + 36 * t)
        } else if (normalized < 0.66) {
          const t = (normalized - 0.33) / 0.33
          r = Math.round(0 + 38 * t); g = Math.round(109 + 57 * t); b = Math.round(50 + 15 * t)
        } else {
          const t = (normalized - 0.66) / 0.34
          r = Math.round(38 + 36 * t); g = Math.round(166 + 68 * t); b = Math.round(65 + 35 * t)
        }
      } else {
        // GitHub light mode green: #ebedf0 → #9be9a8 → #40c463 → #30a14e → #216e39
        if (normalized < 0.25) {
          const t = normalized / 0.25
          r = Math.round(235 - t * 80); g = Math.round(237 - t * 4); b = Math.round(240 - t * 72)
        } else if (normalized < 0.5) {
          const t = (normalized - 0.25) / 0.25
          r = Math.round(155 - t * 91); g = Math.round(233 - t * 37); b = Math.round(168 - t * 69)
        } else if (normalized < 0.75) {
          const t = (normalized - 0.5) / 0.25
          r = Math.round(64 - t * 16); g = Math.round(196 - t * 35); b = Math.round(99 - t * 21)
        } else {
          const t = (normalized - 0.75) / 0.25
          r = Math.round(48 - t * 15); g = Math.round(161 - t * 51); b = Math.round(78 - t * 21)
        }
      }
    } else if (heatmapScale === 'blue') {
      if (isDark) {
        // Dark mode blue: #0a1929 → #0d47a1 → #2196f3 → #6ec6ff
        if (normalized < 0.33) {
          const t = normalized / 0.33
          r = Math.round(10 + 3 * t); g = Math.round(25 + 46 * t); b = Math.round(41 + 120 * t)
        } else if (normalized < 0.66) {
          const t = (normalized - 0.33) / 0.33
          r = Math.round(13 + 20 * t); g = Math.round(71 + 79 * t); b = Math.round(161 + 82 * t)
        } else {
          const t = (normalized - 0.66) / 0.34
          r = Math.round(33 + 77 * t); g = Math.round(150 + 48 * t); b = Math.round(243 + 12 * t)
        }
      } else {
        // Light mode blue: #eef3ff → #a8c8f0 → #5a9bd5 → #2a6cb8
        if (normalized < 0.33) {
          const t = normalized / 0.33
          r = Math.round(238 - t * 70); g = Math.round(243 - t * 43); b = Math.round(255 - t * 15)
        } else if (normalized < 0.66) {
          const t = (normalized - 0.33) / 0.33
          r = Math.round(168 - t * 78); g = Math.round(200 - t * 45); b = Math.round(240 - t * 27)
        } else {
          const t = (normalized - 0.66) / 0.34
          r = Math.round(90 - t * 48); g = Math.round(155 - t * 47); b = Math.round(213 - t * 29)
        }
      }
    } else {
      // red-yellow-green (default)
      if (normalized < 0.5) {
        const t = normalized / 0.5
        r = Math.round(200 + t * 10)
        g = Math.round(60 + t * 120)
        b = 60
      } else {
        const t = (normalized - 0.5) / 0.5
        r = Math.round(210 - t * 165)
        g = Math.round(180 - t * 20)
        b = Math.round(60 + t * 80)
      }
    }

    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }, [showHeatmap, minValue, maxValue, compact, heatmapScale, isDark])

  // Column entries: interleave regular data columns with formula columns
  const columnEntries = useMemo((): ColEntry[] => {
    const colFormulas = formulaResults?.columnFormulas ?? []
    if (numDataCols === 0) return []
    if (colFormulas.length === 0) {
      return Array.from({ length: numDataCols }, (_, i) => ({ type: 'data' as const, cellIndex: i }))
    }

    const entries: ColEntry[] = []
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
  }, [numDataCols, columnHeaders, numValues, formulaResults])

  // Augmented column header rows with formula column headers
  const augmentedColHeaderRows = useMemo((): HeaderCell[][] => {
    if (columnHeaders.length === 0) return []
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

    // If no column formulas, return base rows as HeaderCell
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
    const result: HeaderCell[][] = []
    for (let level = 0; level < baseRows.length; level++) {
      const isValueLevel = hasMultipleValues && level === baseRows.length - 1

      if (level === 0) {
        const augRow: HeaderCell[] = []
        for (let g = 0; g < level0Groups.length; g++) {
          augRow.push({ label: baseRows[0][g].label, colSpan: baseRows[0][g].colSpan })
          const formulas = formulasAfterGroup.get(g)
          if (formulas) {
            for (const fi of formulas) {
              augRow.push({
                label: colFormulas[fi].name,
                colSpan: hasMultipleValues ? numValues : 1,
                rowSpan: hasMultipleValues ? numColDims : numColDims,
                isFormula: true,
              })
            }
          }
        }
        result.push(augRow)
      } else if (isValueLevel) {
        // Value level: regular value labels + formula value labels
        const augRow: HeaderCell[] = []
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
  }, [columnHeaders, numColDims, hasMultipleValues, numValues, valueLabels, formulaResults, fmtHeader, colDimNames])

  // Build display rows: data + subtotals + formula rows
  const displayRows = useMemo((): DisplayRow[] => {
    if (rowHeaders.length === 0) {
      const result: DisplayRow[] = cells.map((_, i) => ({ type: 'data' as const, rowIndex: i }))
      // Insert formula rows at end if applicable
      const rowFormulas = formulaResults?.rowFormulas ?? []
      for (const rf of rowFormulas) {
        result.push({ type: 'formula-row', name: rf.name, cells: rf.cells, rowTotal: rf.rowTotal })
      }
      return result
    }

    // Build data + subtotal rows
    const result: DisplayRow[] = []

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
              if (dr.groupValues[p] !== rf.parentValues[p]) { matches = false; break }
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
  }, [rowHeaders, cells, numRowDims, numDataCols, rowTotals, formulaResults])

  // Filter visible rows based on collapsed groups and showRowTotals (formula rows always visible)
  const visibleRows = useMemo((): DisplayRow[] => {
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
  }, [displayRows, collapsedGroups, rowHeaders, numRowDims, showColTotals])

  // Build row header spans for nested grouping based on visibleRows
  const rowSpans = useMemo(() => {
    if (rowHeaders.length === 0 || numRowDims === 0) return []

    const spans: Array<Array<{ show: boolean; rowSpan: number }>> = visibleRows.map(() =>
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
  }, [rowHeaders, numRowDims, visibleRows])

  // Drill-down click handler for pivot data cells
  const handlePivotCellClick = useCallback((rowIndex: number, cellIndex: number, event: React.MouseEvent) => {
    const filters: Record<string, string> = {}

    // Row dimension filters
    if (rowDimNames && rowHeaders[rowIndex]) {
      rowDimNames.forEach((dimName, i) => {
        if (i < rowHeaders[rowIndex].length) {
          filters[dimName] = rowHeaders[rowIndex][i]
        }
      })
    }

    // Column dimension filters
    const colKeyIndex = Math.floor(cellIndex / numValues)
    if (colDimNames && columnHeaders[colKeyIndex]) {
      colDimNames.forEach((dimName, i) => {
        if (i < columnHeaders[colKeyIndex].length) {
          filters[dimName] = columnHeaders[colKeyIndex][i]
        }
      })
    }

    // Value identification
    const valueIndex = cellIndex % numValues
    const valueLabel = valueLabels[valueIndex] || ''

    console.log('Pivot drill-down filters:', { filters, value: valueLabel })
    onCellClick?.(filters, valueLabel, event)
  }, [rowHeaders, columnHeaders, rowDimNames, colDimNames, numValues, valueLabels, onCellClick])

  // Compact mode: build tooltip content for a cell given row/col context
  const buildTooltipContent = useCallback((value: number, rowIndex: number, cellIndex: number, valueIndex?: number): React.ReactNode => {
    const dims: { label: string; value: string }[] = []
    if (rowDimNames && rowHeaders[rowIndex]) {
      rowDimNames.forEach((dimName, i) => {
        if (i < rowHeaders[rowIndex].length) dims.push({ label: dimName, value: fmtHeader(rowHeaders[rowIndex][i], rowDimNames?.[i]) })
      })
    }
    const colKeyIndex = Math.floor(cellIndex / numValues)
    if (colDimNames && columnHeaders[colKeyIndex]) {
      colDimNames.forEach((dimName, i) => {
        if (i < columnHeaders[colKeyIndex].length) dims.push({ label: dimName, value: fmtHeader(columnHeaders[colKeyIndex][i], colDimNames?.[i]) })
      })
    }
    const formattedValue = fmt(value, valueIndex)
    const cellBg = getCellBg(value)
    return (
      <Box fontFamily="mono" fontSize="xs">
        {dims.length > 0 && (
          <Box fontWeight="600" mb={1}>
            {dims.map(d => d.value).join(' · ')}
          </Box>
        )}
        <Box display="flex" alignItems="center" gap={2}>
          <Box w="10px" h="10px" borderRadius="full" flexShrink={0} bg={cellBg ?? 'fg.subtle'} />
          <Box color="fg.muted">{valueLabels[valueIndex ?? 0] || 'Value'}</Box>
          <Box fontWeight="700" ml="auto">{formattedValue}</Box>
        </Box>
      </Box>
    )
  }, [rowHeaders, columnHeaders, rowDimNames, colDimNames, numValues, fmtHeader, fmt, getCellBg, valueLabels])

  // Compact mode sizing
  const COMPACT_CELL_SIZE = 18
  const headerBg = 'bg.muted'

  // Fixed width for frozen row-dimension columns so sticky left offsets align
  const ROW_DIM_COL_W = 120

  // Tooltip styling for compact mode (ECharts-like)
  const tooltipContentProps = { bg: 'bg.panel', color: 'fg.default', boxShadow: 'lg', borderRadius: 'md', border: '1px solid', borderColor: 'border.muted', px: 3, py: 2 }

  if (cells.length === 0 || (cells.length > 0 && cells[0].length === 0)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || 'No data available for pivot table'}
      </Box>
    )
  }

  // Styling helpers
  const getSubtotalBg = (level: number) => level === 0 ? 'accent.teal/20' : 'accent.teal/12'
  const getSubtotalBorderTop = (level: number) => level === 0 ? '1px solid' : '1px solid'
  const getSubtotalBorderColor = (level: number) => level === 0 ? 'border.subtle' : 'border.muted'

  const colFormulas = formulaResults?.columnFormulas ?? []
  const hasColFormulas = colFormulas.length > 0
  const getLeftOffset = (dimIdx: number) => dimIdx * ROW_DIM_COL_W
  const isLastDim = (_dimIdx: number) => false  // Always show right border on all dimension columns

  // Helper: render cells for a row using columnEntries
  const renderDataCells = (rowIndex: number) => {
    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        const value = cells[rowIndex][entry.cellIndex]
        const cellContent = compact ? null : fmt(value, entry.cellIndex % numValues)
        const cell = (
          <ChakraTable.Cell
            key={`col-${i}`}
            textAlign="right"
            fontFamily="mono"
            fontSize={compact ? '2xs' : 'sm'}
            bg={getCellBg(value)}
            cursor="pointer"
            onClick={(e) => handlePivotCellClick(rowIndex, entry.cellIndex, e)}
            _hover={{ outline: '2px solid', outlineColor: 'accent.teal', outlineOffset: '-2px' }}
            {...(compact ? { p: 0, w: `${COMPACT_CELL_SIZE}px`, minW: `${COMPACT_CELL_SIZE}px`, maxW: `${COMPACT_CELL_SIZE}px`, h: `${COMPACT_CELL_SIZE}px` } : {})}
          >
            {cellContent}
          </ChakraTable.Cell>
        )
        if (compact) {
          return (
            <Tooltip key={`col-${i}`} content={buildTooltipContent(value, rowIndex, entry.cellIndex, entry.cellIndex % numValues)} positioning={{ placement: 'top' }} contentProps={tooltipContentProps}>
              {cell}
            </Tooltip>
          )
        }
        return cell
      }
      // formula-col
      const val = colFormulas[entry.formulaIdx].rowValues[rowIndex][entry.valueIdx]
      return (
        <ChakraTable.Cell
          key={`col-${i}`}
          textAlign="right"
          fontFamily="mono"
          fontSize={compact ? '2xs' : 'sm'}
          bg="accent.secondary/12"
          fontStyle="italic"
          {...(compact ? { p: 0, w: `${COMPACT_CELL_SIZE}px`, minW: `${COMPACT_CELL_SIZE}px`, maxW: `${COMPACT_CELL_SIZE}px`, h: `${COMPACT_CELL_SIZE}px` } : {})}
        >
          {compact ? null : fmt(val, entry.valueIdx)}
        </ChakraTable.Cell>
      )
    })
  }

  const renderSubtotalCells = (dr: Extract<DisplayRow, { type: 'subtotal' }>) => {
    const subtotalBg = getSubtotalBg(dr.level)
    const borderTop = getSubtotalBorderTop(dr.level)
    const borderTopColor = getSubtotalBorderColor(dr.level)
    const groupKey = makeGroupKey(dr.groupValues)

    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return (
          <ChakraTable.Cell
            key={`col-${i}`}
            textAlign="right"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="600"
            bg={subtotalBg}
            color="fg.default"
            borderTop={borderTop}
            borderBottom={dr.level === 0 ? '1px solid' : undefined}
            borderColor={borderTopColor}
          >
            {fmt(dr.cells[entry.cellIndex], entry.cellIndex % numValues)}
          </ChakraTable.Cell>
        )
      }
      // formula-col in subtotal row
      const vals = colFormulas[entry.formulaIdx].subtotalValues.get(groupKey)
      const val = vals?.[entry.valueIdx]
      return (
        <ChakraTable.Cell
          key={`col-${i}`}
          textAlign="right"
          fontFamily="mono"
          fontSize="sm"
          fontWeight="600"
          bg="accent.secondary/12"
          fontStyle="italic"
          color="fg.default"
          borderTop={borderTop}
          borderBottom={dr.level === 0 ? '1px solid' : undefined}
          borderColor={borderTopColor}
        >
          {val !== undefined ? fmt(val, entry.valueIdx) : '\u2014'}
        </ChakraTable.Cell>
      )
    })
  }

  const renderFormulaRowCells = (dr: Extract<DisplayRow, { type: 'formula-row' }>) => {
    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return (
          <ChakraTable.Cell
            key={`col-${i}`}
            textAlign="right"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="600"
            fontStyle="italic"
            color="fg.default"
            bg="accent.secondary/8"
          >
            {fmt(dr.cells[entry.cellIndex], entry.cellIndex % numValues)}
          </ChakraTable.Cell>
        )
      }
      // formula-col in formula-row: show dash
      return (
        <ChakraTable.Cell
          key={`col-${i}`}
          textAlign="center"
          fontFamily="mono"
          fontSize="sm"
          color="fg.subtle"
          bg="accent.secondary/8"
        >
          {'\u2014'}
        </ChakraTable.Cell>
      )
    })
  }

  const numHeaderRows = augmentedColHeaderRows.length

  return (
    <Box
      width="100%"
      height="100%"
      overflow="auto"
      borderRadius="md"
      css={{
        '&::-webkit-scrollbar': { width: '8px', height: '8px' },
        '&::-webkit-scrollbar-track': { background: 'transparent' },
        '&::-webkit-scrollbar-thumb': { background: 'var(--chakra-colors-fg-subtle)', borderRadius: '4px' },
        '&::-webkit-scrollbar-thumb:hover': { background: 'var(--chakra-colors-fg-muted)' },
      }}
    >
      <ChakraTable.Root size="sm" css={{ borderCollapse: 'separate', borderSpacing: compact ? '3px' : 0, ...(compact ? { '& td, & th': { borderBottom: 'none', borderRadius: '3px' } } : { '& td, & th': { borderBottom: '1px solid', borderColor: 'var(--chakra-colors-fg-subtle)' } }) }}>
        <ChakraTable.Header position="sticky" top={0} zIndex={5} bg={headerBg}>
          {/* Column header rows */}
          {augmentedColHeaderRows.map((headerRow, rowIdx) => (
            <ChakraTable.Row key={rowIdx} bg={headerBg}>
              {/* Row dimension name headers */}
              {rowIdx === 0 && numRowDims > 0 && (
                Array.from({ length: numRowDims }, (_, dimIdx) => (
                  <ChakraTable.ColumnHeader
                    key={`dim-${dimIdx}`}
                    rowSpan={numHeaderRows}
                    fontWeight="700"
                    fontSize={compact ? '2xs' : 'xs'}
                    fontFamily={compact ? 'mono' : undefined}
                    textTransform="uppercase"
                    letterSpacing={compact ? undefined : '0.05em'}
                    color="fg.muted"
                    borderRight={isLastDim(dimIdx) ? undefined : '1px solid'}
                    borderColor="border.muted"

                    position="sticky"
                    left={`${getLeftOffset(dimIdx)}px`}
                    bg={headerBg}
                    zIndex={4}
                    w={`${ROW_DIM_COL_W}px`}
                    minW={`${ROW_DIM_COL_W}px`}
                    maxW={`${ROW_DIM_COL_W}px`}
                    {...(compact ? { p: '1px 4px' } : {})}
                  >
                    {rowDimNames?.[dimIdx] || ''}
                  </ChakraTable.ColumnHeader>
                ))
              )}

              {/* Column headers at this level */}
              {headerRow.map((hdr, colIdx) => (
                <ChakraTable.ColumnHeader
                  key={colIdx}
                  colSpan={hdr.colSpan}
                  rowSpan={hdr.rowSpan}
                  fontWeight="700"
                  fontSize={compact ? '2xs' : 'xs'}
                  textTransform="uppercase"
                  letterSpacing={compact ? undefined : '0.05em'}
                  color={hdr.isFormula ? 'accent.secondary' : compact ? 'fg.default' : 'fg.muted'}
                  textAlign="center"
                  minW={compact ? `${COMPACT_CELL_SIZE}px` : '80px'}
                  borderBottom={rowIdx < numHeaderRows - 1 ? '1px solid' : undefined}
                  borderColor="border.muted"
                  zIndex={3}
                  bg={hdr.isFormula ? 'accent.secondary/12' : 'bg.muted'}
                  fontStyle={hdr.isFormula ? 'italic' : undefined}
                  {...(compact ? { px: 0, py: '4px', w: `${COMPACT_CELL_SIZE}px` } : {})}
                >
                  {compact ? (
                    <Box display="flex" justifyContent="center" w="100%">
                      <Box
                        css={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                        transform="rotate(180deg)"
                        fontSize="2xs"
                        fontFamily="mono"
                        whiteSpace="nowrap"
                        lineHeight={1}
                      >
                        {hdr.label}
                      </Box>
                    </Box>
                  ) : hdr.isFormula ? (
                    <Box display="inline-flex" alignItems="center" gap={1} justifyContent="center">
                      <Icon fontSize="md" color="accent.secondary">
                        <LuSquareFunction />
                      </Icon>

                      {hdr.label}
                    </Box>
                  ) : hdr.label}
                </ChakraTable.ColumnHeader>
              ))}

              {/* Row total header */}
              {showRowTotals && rowIdx === 0 && (
                <ChakraTable.ColumnHeader
                  rowSpan={numHeaderRows}
                  fontWeight="700"
                  fontSize="xs"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  color="fg.muted"
                  textAlign="right"
                  borderLeft="2px solid"
                  borderColor="border.default"
                  minW="80px"
                  bg="accent.teal/20"
                  zIndex={3}
                >
                  Total
                </ChakraTable.ColumnHeader>
              )}
            </ChakraTable.Row>
          ))}

          {/* If no column dimensions, still show a header row with value labels */}
          {augmentedColHeaderRows.length === 0 && (
            <ChakraTable.Row bg={headerBg}>
              {numRowDims > 0 && (
                Array.from({ length: numRowDims }, (_, dimIdx) => (
                  <ChakraTable.ColumnHeader
                    key={`dim-${dimIdx}`}
                    fontWeight="700"
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    color="fg.muted"
                    borderRight={isLastDim(dimIdx) ? undefined : '1px solid'}
                    borderColor="border.muted"

                    position="sticky"
                    left={`${getLeftOffset(dimIdx)}px`}
                    bg={headerBg}
                    zIndex={4}
                    w={`${ROW_DIM_COL_W}px`}
                    minW={`${ROW_DIM_COL_W}px`}
                    maxW={`${ROW_DIM_COL_W}px`}
                  >
                    {rowDimNames?.[dimIdx] || ''}
                  </ChakraTable.ColumnHeader>
                ))
              )}
              {valueLabels.map((vl, i) => (
                <ChakraTable.ColumnHeader
                  key={i}
                  fontWeight="700"
                  fontSize="xs"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  color="fg.muted"
                  textAlign="right"
                  minW="80px"
                  zIndex={3}
                  bg={headerBg}
                >
                  {vl}
                </ChakraTable.ColumnHeader>
              ))}
              {showRowTotals && (
                <ChakraTable.ColumnHeader
                  fontWeight="700"
                  fontSize="xs"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  color="fg.muted"
                  textAlign="right"
                  borderLeft="2px solid"
                  borderColor="border.default"
                  minW="80px"
                  bg="accent.teal/20"
                  zIndex={3}
                >
                  Total
                </ChakraTable.ColumnHeader>
              )}
            </ChakraTable.Row>
          )}
        </ChakraTable.Header>

        <ChakraTable.Body>
          {/* Data + subtotal + formula rows */}
          {visibleRows.map((displayRow, displayIndex) => {
            // Formula row
            if (displayRow.type === 'formula-row') {
              const formulaDimLevel = displayRow.dimensionLevel ?? 0
              // Sub-level formulas: parent cells are covered by rowSpan, so only render from dimensionLevel onward
              // Top-level formulas: span all row dim columns
              const isSubLevel = formulaDimLevel > 0 && numRowDims > 1
              const headerColSpan = isSubLevel ? Math.max(1, numRowDims - formulaDimLevel) : (numRowDims || 1)

              return (
                <ChakraTable.Row key={`formula-${displayIndex}`}>
                  <ChakraTable.Cell
                    colSpan={headerColSpan}
                    fontWeight="600"
                    fontSize="sm"
                    fontStyle="italic"
                    color="accent.secondary"
                    bg="accent.secondary/12"
                    borderRight="1px solid"
                    borderColor="fg.muted"

                    position="sticky"
                    left={isSubLevel ? `${getLeftOffset(formulaDimLevel)}px` : 0}
                    zIndex={2}
                  >
                    <Box display="flex" alignItems="center" gap={1}>
                      <Icon fontSize="sm" color="accent.secondary" flexShrink={0}>
                        <LuSquareFunction />
                      </Icon>
                      {displayRow.name}
                    </Box>
                  </ChakraTable.Cell>

                  {hasColFormulas ? renderFormulaRowCells(displayRow) : (
                    displayRow.cells.map((value, colIndex) => (
                      <ChakraTable.Cell
                        key={colIndex}
                        textAlign="right"
                        fontFamily="mono"
                        fontSize="sm"
                        fontWeight="600"
                        fontStyle="italic"
                        color="fg.default"
                        bg="accent.secondary/8"
                      >
                        {fmt(value, colIndex % numValues)}
                      </ChakraTable.Cell>
                    ))
                  )}

                  {showRowTotals && (
                    <ChakraTable.Cell
                      textAlign="right"
                      fontFamily="mono"
                      fontSize="sm"
                      fontWeight="700"
                      fontStyle="italic"
                      borderLeft="2px solid"
                      borderColor="border.default"
                      bg="accent.secondary/12"
                      color="accent.secondary"
                    >
                      {fmt(displayRow.rowTotal)}
                    </ChakraTable.Cell>
                  )}
                </ChakraTable.Row>
              )
            }

            // Subtotal row
            if (displayRow.type === 'subtotal') {
              const S = displayRow.level
              const subtotalBg = getSubtotalBg(S)
              const borderTop = getSubtotalBorderTop(S)
              const borderTopColor = getSubtotalBorderColor(S)
              const groupKey = makeGroupKey(displayRow.groupValues)
              const collapsed = collapsedGroups.has(groupKey)

              return (
                <ChakraTable.Row key={`subtotal-${displayIndex}`}>
                  <ChakraTable.Cell
                    colSpan={numRowDims - S}
                    fontWeight="700"
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    color="fg.default"
                    borderTop={borderTop}
                    borderBottom={S === 0 ? '1px solid' : undefined}
                    borderColor={borderTopColor}

                    position="sticky"
                    left={`${getLeftOffset(S)}px`}
                    bg={headerBg}
                    zIndex={2}
                    cursor="pointer"
                    onClick={() => toggleGroup(groupKey)}
                    _hover={{ opacity: 0.8 }}
                  >
                    <Box display="flex" alignItems="center" gap={1}>
                      <Box as={collapsed ? LuChevronRight : LuChevronUp} fontSize="sm" flexShrink={0} />
                      {displayRow.label}
                    </Box>
                  </ChakraTable.Cell>

                  {hasColFormulas ? renderSubtotalCells(displayRow) : (
                    displayRow.cells.map((value, colIndex) => (
                      <ChakraTable.Cell
                        key={colIndex}
                        textAlign="right"
                        fontFamily="mono"
                        fontSize="sm"
                        fontWeight="600"
                        bg={subtotalBg}
                        color="fg.default"
                        borderTop={borderTop}
                        borderBottom={S === 0 ? '1px solid' : undefined}
                        borderColor={borderTopColor}
                      >
                        {fmt(value, colIndex % numValues)}
                      </ChakraTable.Cell>
                    ))
                  )}

                  {showRowTotals && (
                    <ChakraTable.Cell
                      textAlign="right"
                      fontFamily="mono"
                      fontSize="sm"
                      fontWeight="700"
                      borderLeft="2px solid"
                      borderTop={borderTop}
                      borderBottom={S === 0 ? '1px solid' : undefined}
                      borderColor={borderTopColor}
                      bg={S === 0 ? 'accent.teal/40' : 'accent.teal/30'}
                      color="fg.default"
                    >
                      {fmt(displayRow.rowTotal)}
                    </ChakraTable.Cell>
                  )}
                </ChakraTable.Row>
              )
            }

            // Data row
            const rowIndex = displayRow.rowIndex
            return (
              <ChakraTable.Row key={`data-${displayIndex}`} _hover={{ bg: 'bg.muted' }}>
                {/* Row dimension headers */}
                {rowSpans[displayIndex]?.map((spanInfo, dimIdx) =>
                  spanInfo.show ? (
                    <ChakraTable.Cell
                      key={`dim-${dimIdx}`}
                      rowSpan={spanInfo.rowSpan}
                      fontWeight="600"
                      fontSize={compact ? '2xs' : 'sm'}
                      fontFamily={compact ? 'mono' : undefined}
                      borderRight={isLastDim(dimIdx) ? undefined : '1px solid'}
                      borderColor="border.muted"

                      position="sticky"
                      left={`${getLeftOffset(dimIdx)}px`}
                      bg={headerBg}
                      zIndex={2}
                      verticalAlign="top"
                      w={`${ROW_DIM_COL_W}px`}
                      minW={`${ROW_DIM_COL_W}px`}
                      maxW={`${ROW_DIM_COL_W}px`}
                      {...(compact ? { p: '1px 4px', whiteSpace: 'nowrap', h: `${COMPACT_CELL_SIZE}px` } : {})}
                    >
                      {fmtHeader(rowHeaders[rowIndex][dimIdx], rowDimNames?.[dimIdx])}
                    </ChakraTable.Cell>
                  ) : null
                )}

                {/* Data cells (interleaved with formula columns if applicable) */}
                {hasColFormulas ? renderDataCells(rowIndex) : (
                  cells[rowIndex].map((value, colIndex) => {
                    const cell = (
                      <ChakraTable.Cell
                        key={colIndex}
                        textAlign="right"
                        fontFamily="mono"
                        fontSize={compact ? '2xs' : 'sm'}
                        bg={getCellBg(value)}
                        cursor="pointer"
                        onClick={(e) => handlePivotCellClick(rowIndex, colIndex, e)}
                        _hover={{ outline: '2px solid', outlineColor: 'accent.teal', outlineOffset: '-2px' }}
                        {...(compact ? { p: 0, w: `${COMPACT_CELL_SIZE}px`, minW: `${COMPACT_CELL_SIZE}px`, maxW: `${COMPACT_CELL_SIZE}px`, h: `${COMPACT_CELL_SIZE}px` } : {})}
                      >
                        {compact ? null : fmt(value, colIndex % numValues)}
                      </ChakraTable.Cell>
                    )
                    if (compact) {
                      return (
                        <Tooltip key={colIndex} content={buildTooltipContent(value, rowIndex, colIndex, colIndex % numValues)} positioning={{ placement: 'top' }} contentProps={tooltipContentProps}>
                          {cell}
                        </Tooltip>
                      )
                    }
                    return cell
                  })
                )}

                {/* Row total */}
                {showRowTotals && (
                  <ChakraTable.Cell
                    textAlign="right"
                    fontFamily="mono"
                    fontSize={compact ? '2xs' : 'sm'}
                    borderLeft="1px solid"
                    borderColor="border.default"
                    bg="accent.teal/5"
                    color="fg.subtle"
                  >
                    {fmt(rowTotals[rowIndex])}
                  </ChakraTable.Cell>
                )}
              </ChakraTable.Row>
            )
          })}
        </ChakraTable.Body>
      </ChakraTable.Root>
    </Box>
  )
}
