'use client'

import { useState, useMemo, useCallback } from 'react'
import { Box, Table as ChakraTable } from '@chakra-ui/react'
import { formatLargeNumber, formatNumber, formatDateValue, applyPrefixSuffix } from '@/lib/chart/chart-format'
import type { PivotData, FormulaResults } from '@/lib/chart/pivot-utils'
import { useAppSelector } from '@/store/hooks'
import type { ColumnFormatConfig } from '@/lib/types'
import { getPivotCellBg, type HeatmapScale } from './PivotTableHeatmap'
import { PivotTableTooltipContent } from './PivotTableTooltip'
import { PivotTableHeader } from './PivotTableHeader'
import { PivotTableBody, makeGroupKey } from './PivotTableBody'

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
  const { rowHeaders, columnHeaders, cells, cellPresent, rowTotals, valueLabels } = pivotData
  // Presence lookup that tolerates pre-existing PivotData without the field
  // (defaults to present, i.e. legacy behaviour) — formula/subtotal rows pass true.
  const isPresent = useCallback(
    (r: number, c: number): boolean => cellPresent?.[r]?.[c] ?? true,
    [cellPresent],
  )

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

  // Faint neutral fill for missing (N/A) cells — visually distinct from any
  // heatmap colour, so "no data" never reads as a low value.
  const absentBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)'

  // Compute min/max across regular cells only for heatmap (excludes formula cells
  // AND missing cells — a missing cell is N/A, not a 0, so it must not drag the
  // colour domain down).
  const { minValue, maxValue } = useMemo(() => {
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
  }, [cells, cellPresent])

  const getCellBg = useCallback((value: number, present = true): string | undefined => {
    return getPivotCellBg({ value, minValue, maxValue, showHeatmap, compact, heatmapScale, isDark, absentBg, present })
  }, [showHeatmap, minValue, maxValue, compact, heatmapScale, isDark, absentBg])

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
  const buildTooltipContent = useCallback((value: number, rowIndex: number, cellIndex: number, valueIndex?: number, present = true): React.ReactNode => {
    return (
      <PivotTableTooltipContent
        value={value}
        rowIndex={rowIndex}
        cellIndex={cellIndex}
        valueIndex={valueIndex}
        present={present}
        rowHeaders={rowHeaders}
        columnHeaders={columnHeaders}
        rowDimNames={rowDimNames}
        colDimNames={colDimNames}
        numValues={numValues}
        valueLabels={valueLabels}
        fmtHeader={fmtHeader}
        fmt={fmt}
        getCellBg={getCellBg}
      />
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

  const colFormulas = formulaResults?.columnFormulas ?? []
  const hasColFormulas = colFormulas.length > 0
  const getLeftOffset = (dimIdx: number) => dimIdx * ROW_DIM_COL_W
  const isLastDim = (_dimIdx: number) => false  // Always show right border on all dimension columns

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
        <PivotTableHeader
          augmentedColHeaderRows={augmentedColHeaderRows}
          numRowDims={numRowDims}
          numHeaderRows={numHeaderRows}
          rowDimNames={rowDimNames}
          showRowTotals={showRowTotals}
          compact={compact}
          headerBg={headerBg}
          getLeftOffset={getLeftOffset}
          isLastDim={isLastDim}
          ROW_DIM_COL_W={ROW_DIM_COL_W}
          COMPACT_CELL_SIZE={COMPACT_CELL_SIZE}
          valueLabels={valueLabels}
        />

        <PivotTableBody
          visibleRows={visibleRows}
          rowSpans={rowSpans}
          numRowDims={numRowDims}
          hasColFormulas={hasColFormulas}
          showRowTotals={showRowTotals}
          compact={compact}
          columnEntries={columnEntries}
          colFormulas={colFormulas}
          cells={cells}
          rowTotals={rowTotals}
          rowHeaders={rowHeaders}
          rowDimNames={rowDimNames}
          numValues={numValues}
          fmt={fmt}
          fmtHeader={fmtHeader}
          getCellBg={getCellBg}
          isPresent={isPresent}
          handlePivotCellClick={handlePivotCellClick}
          buildTooltipContent={buildTooltipContent}
          collapsedGroups={collapsedGroups}
          toggleGroup={toggleGroup}
          headerBg={headerBg}
          getLeftOffset={getLeftOffset}
          isLastDim={isLastDim}
          ROW_DIM_COL_W={ROW_DIM_COL_W}
          COMPACT_CELL_SIZE={COMPACT_CELL_SIZE}
          tooltipContentProps={tooltipContentProps}
        />
      </ChakraTable.Root>
    </Box>
  )
}
