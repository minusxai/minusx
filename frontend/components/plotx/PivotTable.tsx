'use client'

import { useState, useMemo, useCallback } from 'react'
import { TooltipProvider } from '@/components/kit/tooltip'
import { formatLargeNumber, formatNumber, formatDateValue, applyPrefixSuffix, formatD3Number, formatD3Date } from '@/lib/chart/chart-format'
import type { PivotData, FormulaResults } from '@/lib/chart/pivot-utils'
import { useAppSelector } from '@/store/hooks'
import type { ColumnFormatConfig, ConditionalFormatRule } from '@/lib/types'
import { getPivotCellBg, type HeatmapScale } from './PivotTableHeatmap'
import { PivotTableTooltipContent } from './PivotTableTooltip'
import { PivotTableHeader } from './PivotTableHeader'
import { PivotTableBody } from './PivotTableBody'
import { TableBottomBar } from './TableBottomBar'
import {
  buildColumnEntries,
  buildColHeaderRows,
  buildDisplayRows,
  filterVisibleRows,
  buildRowSpans,
  computeHeatmapDomain,
  buildPivotCellBg,
} from '@/lib/chart/pivot-grid'

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
  /** Conditional background-color rules over VALUE columns — same vocabulary as the flat table. */
  conditionalFormats?: ConditionalFormatRule[]
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
  conditionalFormats,
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

  // Format a numeric cell value per the value column's config: `format` (d3, the
  // unified viz vocabulary) wins; legacy decimal/prefix/suffix fall back.
  // When valueIndex is omitted (totals), fall back to first value column's format
  const fmt = useCallback((value: number, valueIndex?: number): string => {
    if (columnFormats && valueColumns) {
      const idx = valueIndex !== undefined ? valueIndex % (valueColumns.length || 1) : 0
      const colName = valueColumns[idx]
      const cfg = colName ? columnFormats[colName] : undefined
      if (cfg?.format) {
        const d3v = formatD3Number(value, cfg.format)
        if (d3v != null) return d3v
      }
      const dp = cfg?.decimalPoints
      const formatted = dp != null ? formatNumber(value, dp) : formatLargeNumber(value)
      return applyPrefixSuffix(formatted, cfg?.prefix, cfg?.suffix)
    }
    return formatLargeNumber(value)
  }, [columnFormats, valueColumns])

  // Format a header value (row or column): a d3 time pattern (`format`) wins for
  // date dimensions; the legacy Unicode dateFormat falls back.
  const fmtHeader = useCallback((value: string, dimName?: string): string => {
    if (!dimName || !columnFormats) return value
    const cfg = columnFormats[dimName]
    if (cfg?.format) {
      const d = new Date(value)
      const d3v = isNaN(d.getTime()) ? null : formatD3Date(d, cfg.format)
      if (d3v != null) return d3v
    }
    if (cfg?.dateFormat) return formatDateValue(value, cfg.dateFormat)
    return value
  }, [columnFormats])

  const numRowDims = rowHeaders.length > 0 ? rowHeaders[0].length : 0
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

  // Heatmap colour domain across present cells only (pure engine).
  const { minValue, maxValue } = useMemo(() => computeHeatmapDomain(pivotData), [pivotData])

  const getCellBg = useCallback((value: number, present = true): string | undefined => {
    return getPivotCellBg({ value, minValue, maxValue, showHeatmap, compact, heatmapScale, isDark, absentBg, present })
  }, [showHeatmap, minValue, maxValue, compact, heatmapScale, isDark, absentBg])

  // Conditional formats (same rule vocabulary as the flat table) — evaluated per
  // data cell, overriding the heatmap where a rule paints.
  const getConditionalBg = useMemo(
    () => buildPivotCellBg(conditionalFormats, pivotData, valueColumns, { isDark }),
    [conditionalFormats, pivotData, valueColumns, isDark]
  )

  const getDataCellBg = useCallback((value: number, present = true, rowIndex?: number, cellIndex?: number): string | undefined => {
    if (rowIndex != null && cellIndex != null) {
      const conditional = getConditionalBg(rowIndex, cellIndex)
      if (conditional) return conditional
    }
    return getCellBg(value, present)
  }, [getConditionalBg, getCellBg])

  // Column entries: interleave regular data columns with formula columns (pure engine).
  const columnEntries = useMemo(() => buildColumnEntries(pivotData, formulaResults), [pivotData, formulaResults])

  // Nested column header rows augmented with formula columns (pure engine).
  const augmentedColHeaderRows = useMemo(
    () => buildColHeaderRows(pivotData, formulaResults, fmtHeader, colDimNames),
    [pivotData, formulaResults, fmtHeader, colDimNames]
  )

  // Display rows: data + subtotals + formula rows (pure engine).
  const displayRows = useMemo(() => buildDisplayRows(pivotData, formulaResults), [pivotData, formulaResults])

  // Filter rows for collapsed groups / the column-totals toggle (pure engine).
  const visibleRows = useMemo(
    () => filterVisibleRows(displayRows, pivotData, collapsedGroups, showColTotals),
    [displayRows, pivotData, collapsedGroups, showColTotals]
  )

  // Row header spans for nested grouping based on visibleRows (pure engine).
  const rowSpans = useMemo(
    () => buildRowSpans(visibleRows, rowHeaders, numRowDims),
    [visibleRows, rowHeaders, numRowDims]
  )

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

  // CSV export: flattened cross-tab — dimension columns, one column per leaf
  // (colKey path × value), plus the Total column when shown. Data rows only.
  const downloadCsv = useCallback(() => {
    const escape = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v
    const header: string[] = [...(rowDimNames ?? [])]
    for (const entry of columnEntries) {
      if (entry.type === 'data') {
        const colKey = columnHeaders[Math.floor(entry.cellIndex / numValues)] ?? []
        const parts = [...colKey]
        if (valueLabels.length > 1) parts.push(valueLabels[entry.cellIndex % numValues])
        header.push(parts.join(' / ') || valueLabels[entry.cellIndex % numValues] || 'value')
      } else {
        header.push((formulaResults?.columnFormulas ?? [])[entry.formulaIdx]?.name ?? 'formula')
      }
    }
    if (showRowTotals) header.push('Total')

    const dataRows = cells.map((row, r) => {
      const out: string[] = [...(rowHeaders[r] ?? [])]
      for (const entry of columnEntries) {
        if (entry.type === 'data') {
          out.push(isPresent(r, entry.cellIndex) ? String(row[entry.cellIndex]) : '')
        } else {
          const v = (formulaResults?.columnFormulas ?? [])[entry.formulaIdx]?.rowValues[r]?.[entry.valueIdx]
          out.push(v != null ? String(v) : '')
        }
      }
      if (showRowTotals) out.push(String(rowTotals[r]))
      return out.map(escape).join(',')
    })

    const csv = [header.map(escape).join(','), ...dataRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    link.download = `pivot-${ts}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [rowDimNames, columnEntries, columnHeaders, numValues, valueLabels, formulaResults, showRowTotals, cells, rowHeaders, rowTotals, isPresent])

  // Compact mode sizing
  const COMPACT_CELL_SIZE = 18

  // Fixed width for frozen row-dimension columns so sticky left offsets align
  const ROW_DIM_COL_W = 120

  if (cells.length === 0 || (cells.length > 0 && cells[0].length === 0)) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {emptyMessage || 'No data available for pivot table'}
      </div>
    )
  }

  const colFormulas = formulaResults?.columnFormulas ?? []
  const hasColFormulas = colFormulas.length > 0
  const getLeftOffset = (dimIdx: number) => dimIdx * ROW_DIM_COL_W
  const isLastDim = (_dimIdx: number) => false  // Always show right border on all dimension columns

  const numHeaderRows = augmentedColHeaderRows.length

  return (
    <TooltipProvider>
    <div className="flex h-full w-full min-h-0 flex-col">
    {/* Base pivot chrome as a low-specificity (:where) stylesheet — NOT inline and
        NOT !important utilities — so scoped css overrides (`.mx-row-odd { … }`,
        `.mx-pivot th { … }` in the envelope css field) still win. Travels with the
        component (works in stories/foreignObject, no globals.css dependency). */}
    <style>{PIVOT_BASE_CSS}</style>
    <div className="mx-pivot-scroll w-full flex-1 min-h-0 overflow-auto rounded-md">
      {/* mx-pivot + mx-table: the pivot shares the flat table's STABLE class
          contract (.mx-table .mx-header-row .mx-th .mx-row .mx-cell
          .mx-col-<name> .mx-toolbar) for css overrides; `.mx-pivot` stays as
          the pivot-specific root for element selectors (`.mx-pivot th { … }`). */}
      <table
        className={`mx-pivot mx-table${compact ? ' mx-pivot-compact' : ''} w-full caption-bottom`}
        style={{ borderCollapse: 'separate', borderSpacing: compact ? '3px' : 0 }}
      >
        <PivotTableHeader
          augmentedColHeaderRows={augmentedColHeaderRows}
          numRowDims={numRowDims}
          numHeaderRows={numHeaderRows}
          rowDimNames={rowDimNames}
          showRowTotals={showRowTotals}
          compact={compact}
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
          getCellBg={getDataCellBg}
          valueColumns={valueColumns}
          isPresent={isPresent}
          handlePivotCellClick={handlePivotCellClick}
          buildTooltipContent={buildTooltipContent}
          collapsedGroups={collapsedGroups}
          toggleGroup={toggleGroup}
          getLeftOffset={getLeftOffset}
          isLastDim={isLastDim}
          ROW_DIM_COL_W={ROW_DIM_COL_W}
          COMPACT_CELL_SIZE={COMPACT_CELL_SIZE}
        />
      </table>
    </div>

    {/* Shared grid toolbar (same chrome as the flat table; hides via `.mx-toolbar
        { display: none }`). Compact mode is a chart-like surface — no toolbar. */}
    {!compact && (
      <TableBottomBar
        filteredRowCount={cells.length}
        totalRowCount={cells.length}
        downloadCsv={downloadCsv}
      />
    )}
    </div>
    </TooltipProvider>
  )
}

// Default pivot chrome (cell padding/borders, zebra stripe, scrollbar). Kept at
// zero-to-minimal specificity via :where() so the envelope's scoped css field
// (`.mx-viz-scope-X { .mx-row-odd { … } }`, 0-2-0) overrides every rule here.
const PIVOT_BASE_CSS = `
.mx-pivot-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.mx-pivot-scroll::-webkit-scrollbar-track { background: transparent; }
.mx-pivot-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.mx-pivot-scroll::-webkit-scrollbar-thumb:hover { background: var(--muted-foreground); }
:where(.mx-pivot:not(.mx-pivot-compact)) :where(td, th) { padding: 6px 8px; border-bottom: 1px solid var(--muted-foreground); }
:where(.mx-pivot.mx-pivot-compact) :where(td, th) { border-bottom: none; border-radius: 3px; }
:where(.mx-pivot:not(.mx-pivot-compact) tbody) tr:where(.mx-row-odd) { background: var(--muted); }
`
