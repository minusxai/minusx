'use client'

import { LuChevronUp, LuChevronRight, LuSquareFunction } from 'react-icons/lu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/kit/tooltip'
import type { FormulaResults } from '@/lib/chart/pivot-utils'
import { makeGroupKey, type PivotDisplayRow as DisplayRow, type PivotColEntry as ColEntry } from '@/lib/chart/pivot-grid'
import { cssColumnClass } from './table-v2-utils'
import { getContrastText } from '@/lib/chart/conditional-format-utils'

// Re-exported for callers that historically imported the group-key encoding
// from here; the canonical definition lives in the pure grid engine.
export { makeGroupKey }

// Accent constants (the app palette — same values the converted header uses).
const TEAL = '#16a085'
const SECONDARY = '#9b59b6'
const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

// Styling helpers for subtotal rows (level 0 = strongest accent).
const getSubtotalBg = (level: number) => level === 0 ? mix(TEAL, 20) : mix(TEAL, 12)
const subtotalBorders = (level: number): React.CSSProperties => ({
  borderTop: '1px solid var(--border)',
  ...(level === 0 ? { borderBottom: '1px solid var(--border)' } : {}),
})

// Shared cell class fragments. Native <tbody>/<td> on the kit/Tailwind stack
// (Renderer_v2 Phase 3) — same DOM + stable class contract (.mx-row/.mx-cell)
// as before; only the styling system changed.
const NUM_CELL = 'text-right font-mono'
const dataCellClass = (compact: boolean) =>
  `${NUM_CELL} cursor-pointer ${compact ? 'p-0 text-[10px]' : 'text-sm'} hover:[outline:2px_solid_#16a085] hover:[outline-offset:-2px]`
const compactSize = (size: number): React.CSSProperties =>
  ({ width: size, minWidth: size, maxWidth: size, height: size })

// Table body (data + subtotal + formula rows).
interface PivotTableBodyProps {
  visibleRows: DisplayRow[]
  rowSpans: Array<Array<{ show: boolean; rowSpan: number }>>
  numRowDims: number
  hasColFormulas: boolean
  showRowTotals: boolean
  compact: boolean
  columnEntries: ColEntry[]
  colFormulas: FormulaResults['columnFormulas']
  cells: number[][]
  rowTotals: number[]
  rowHeaders: string[][]
  rowDimNames?: string[]
  numValues: number
  fmt: (value: number, valueIndex?: number) => string
  fmtHeader: (value: string, dimName?: string) => string
  getCellBg: (value: number, present?: boolean, rowIndex?: number, cellIndex?: number) => string | undefined
  valueColumns?: string[]
  isPresent: (r: number, c: number) => boolean
  handlePivotCellClick: (rowIndex: number, cellIndex: number, event: React.MouseEvent) => void
  buildTooltipContent: (value: number, rowIndex: number, cellIndex: number, valueIndex?: number, present?: boolean) => React.ReactNode
  collapsedGroups: Set<string>
  toggleGroup: (groupKey: string) => void
  getLeftOffset: (dimIdx: number) => number
  isLastDim: (dimIdx: number) => boolean
  ROW_DIM_COL_W: number
  COMPACT_CELL_SIZE: number
}

export const PivotTableBody = ({
  visibleRows,
  rowSpans,
  numRowDims,
  hasColFormulas,
  showRowTotals,
  compact,
  columnEntries,
  colFormulas,
  cells,
  rowTotals,
  rowHeaders,
  rowDimNames,
  numValues,
  fmt,
  fmtHeader,
  getCellBg,
  valueColumns,
  isPresent,
  handlePivotCellClick,
  buildTooltipContent,
  collapsedGroups,
  toggleGroup,
  getLeftOffset,
  isLastDim,
  ROW_DIM_COL_W,
  COMPACT_CELL_SIZE,
}: PivotTableBodyProps) => {
  // Shared class contract: every data cell carries .mx-cell plus the value
  // column's .mx-col-<name> (same selector vocabulary as the flat table).
  const cellClass = (cellIndex: number): string => {
    const col = valueColumns?.[cellIndex % (valueColumns.length || 1)]
    return col ? `mx-cell ${cssColumnClass(col)}` : 'mx-cell'
  }

  // Contrast text only makes sense for concrete hex/rgb ramps (heatmap,
  // conditional rules) — color-mix accents keep the inherited text color.
  const hasContrastText = (bg?: string): boolean =>
    !!bg && (bg.startsWith('#') || bg.startsWith('rgb'))

  // Compact mode: wrap a cell in the kit (Radix) tooltip. Content renders inside
  // the <td> (valid flow content) — the kit TooltipContent is portal-free by
  // design (story/foreignObject-safe), and its popper wrapper is out-of-flow.
  const withTooltip = (key: React.Key, cell: React.ReactElement, content: React.ReactNode) => (
    <Tooltip key={key}>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent side="top">{content}</TooltipContent>
    </Tooltip>
  )

  // Zebra parity counts DATA rows only (subtotal/formula rows keep accents).
  const dataRowOrdinals = new Map<number, number>()
  {
    let ordinal = 0
    visibleRows.forEach((dr, i) => { if (dr.type === 'data') dataRowOrdinals.set(i, ordinal++) })
  }

  const renderValueCell = (rowIndex: number, cellIndex: number, key: React.Key) => {
    const value = cells[rowIndex][cellIndex]
    const present = isPresent(rowIndex, cellIndex)
    const bgValue = getCellBg(value, present, rowIndex, cellIndex)
    const cell = (
      <td
        key={key}
        className={`${cellClass(cellIndex)} ${dataCellClass(compact)}`}
        style={{
          ...(bgValue ? { background: bgValue } : {}),
          ...(hasContrastText(bgValue) ? { color: getContrastText(bgValue!) } : {}),
          ...(compact ? compactSize(COMPACT_CELL_SIZE) : {}),
        }}
        onClick={(e) => handlePivotCellClick(rowIndex, cellIndex, e)}
      >
        {compact ? null : (present ? fmt(value, cellIndex % numValues) : '')}
      </td>
    )
    if (compact) {
      return withTooltip(key, cell, buildTooltipContent(value, rowIndex, cellIndex, cellIndex % numValues, present))
    }
    return cell
  }

  // Helper: render cells for a row using columnEntries (formula columns interleaved)
  const renderDataCells = (rowIndex: number) => {
    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return renderValueCell(rowIndex, entry.cellIndex, `col-${i}`)
      }
      // formula-col
      const val = colFormulas[entry.formulaIdx].rowValues[rowIndex][entry.valueIdx]
      return (
        <td
          key={`col-${i}`}
          className={`${NUM_CELL} italic ${compact ? 'p-0 text-[10px]' : 'text-sm'}`}
          style={{ background: mix(SECONDARY, 12), ...(compact ? compactSize(COMPACT_CELL_SIZE) : {}) }}
        >
          {compact ? null : fmt(val, entry.valueIdx)}
        </td>
      )
    })
  }

  const renderSubtotalCells = (dr: Extract<DisplayRow, { type: 'subtotal' }>) => {
    const groupKey = makeGroupKey(dr.groupValues)

    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return (
          <td
            key={`col-${i}`}
            className={`${NUM_CELL} text-sm font-semibold text-foreground`}
            style={{ background: getSubtotalBg(dr.level), ...subtotalBorders(dr.level) }}
          >
            {fmt(dr.cells[entry.cellIndex], entry.cellIndex % numValues)}
          </td>
        )
      }
      // formula-col in subtotal row
      const vals = colFormulas[entry.formulaIdx].subtotalValues.get(groupKey)
      const val = vals?.[entry.valueIdx]
      return (
        <td
          key={`col-${i}`}
          className={`${NUM_CELL} text-sm font-semibold italic text-foreground`}
          style={{ background: mix(SECONDARY, 12), ...subtotalBorders(dr.level) }}
        >
          {val !== undefined ? fmt(val, entry.valueIdx) : '—'}
        </td>
      )
    })
  }

  const renderFormulaRowCells = (dr: Extract<DisplayRow, { type: 'formula-row' }>) => {
    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return (
          <td
            key={`col-${i}`}
            className={`${NUM_CELL} text-sm font-semibold italic text-foreground`}
            style={{ background: mix(SECONDARY, 8) }}
          >
            {fmt(dr.cells[entry.cellIndex], entry.cellIndex % numValues)}
          </td>
        )
      }
      // formula-col in formula-row: show dash
      return (
        <td
          key={`col-${i}`}
          className="text-center font-mono text-sm text-muted-foreground"
          style={{ background: mix(SECONDARY, 8) }}
        >
          {'—'}
        </td>
      )
    })
  }

  return (
    <tbody>
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
            <tr key={`formula-${displayIndex}`} className="mx-row-formula">
              <td
                colSpan={headerColSpan}
                className="sticky z-[2] text-sm font-semibold italic text-[#9b59b6]"
                style={{
                  left: isSubLevel ? getLeftOffset(formulaDimLevel) : 0,
                  background: `linear-gradient(${mix(SECONDARY, 12)}, ${mix(SECONDARY, 12)}), var(--muted)`,
                  borderRight: '1px solid var(--muted-foreground)',
                }}
              >
                <span className="flex items-center gap-1">
                  <LuSquareFunction className="shrink-0 text-sm text-[#9b59b6]" />
                  {displayRow.name}
                </span>
              </td>

              {hasColFormulas ? renderFormulaRowCells(displayRow) : (
                displayRow.cells.map((value, colIndex) => (
                  <td
                    key={colIndex}
                    className={`${NUM_CELL} text-sm font-semibold italic text-foreground`}
                    style={{ background: mix(SECONDARY, 8) }}
                  >
                    {fmt(value, colIndex % numValues)}
                  </td>
                ))
              )}

              {showRowTotals && (
                <td
                  className={`${NUM_CELL} text-sm font-bold italic text-[#9b59b6]`}
                  style={{ borderLeft: '2px solid var(--border)', background: mix(SECONDARY, 12) }}
                >
                  {fmt(displayRow.rowTotal)}
                </td>
              )}
            </tr>
          )
        }

        // Subtotal row
        if (displayRow.type === 'subtotal') {
          const S = displayRow.level
          const groupKey = makeGroupKey(displayRow.groupValues)
          const collapsed = collapsedGroups.has(groupKey)
          const Chevron = collapsed ? LuChevronRight : LuChevronUp

          return (
            <tr key={`subtotal-${displayIndex}`} className="mx-row-subtotal">
              <td
                colSpan={numRowDims - S}
                className="sticky z-[2] cursor-pointer bg-muted text-xs font-bold uppercase tracking-wider text-foreground hover:opacity-80"
                style={{ left: getLeftOffset(S), ...subtotalBorders(S) }}
                onClick={() => toggleGroup(groupKey)}
              >
                <span className="flex items-center gap-1">
                  <Chevron className="shrink-0 text-sm" />
                  {displayRow.label}
                </span>
              </td>

              {hasColFormulas ? renderSubtotalCells(displayRow) : (
                displayRow.cells.map((value, colIndex) => (
                  <td
                    key={colIndex}
                    className={`${NUM_CELL} text-sm font-semibold text-foreground`}
                    style={{ background: getSubtotalBg(S), ...subtotalBorders(S) }}
                  >
                    {fmt(value, colIndex % numValues)}
                  </td>
                ))
              )}

              {showRowTotals && (
                <td
                  className={`${NUM_CELL} text-sm font-bold text-foreground`}
                  style={{
                    borderLeft: '2px solid var(--border)',
                    background: S === 0 ? mix(TEAL, 40) : mix(TEAL, 30),
                    ...subtotalBorders(S),
                  }}
                >
                  {fmt(displayRow.rowTotal)}
                </td>
              )}
            </tr>
          )
        }

        // Data row
        const rowIndex = displayRow.rowIndex
        return (
          <tr
            key={`data-${displayIndex}`}
            className={`mx-row ${(dataRowOrdinals.get(displayIndex) ?? 0) % 2 === 1 ? 'mx-row-odd' : 'mx-row-even'} hover:bg-muted`}
          >
            {/* Row dimension headers */}
            {rowSpans[displayIndex]?.map((spanInfo, dimIdx) =>
              spanInfo.show ? (
                <td
                  key={`dim-${dimIdx}`}
                  rowSpan={spanInfo.rowSpan}
                  className={`sticky z-[2] bg-muted align-top font-semibold ${compact ? 'whitespace-nowrap font-mono text-[10px]' : 'text-sm'}`}
                  style={{
                    left: getLeftOffset(dimIdx),
                    width: ROW_DIM_COL_W, minWidth: ROW_DIM_COL_W, maxWidth: ROW_DIM_COL_W,
                    borderRight: isLastDim(dimIdx) ? undefined : '1px solid var(--border)',
                    ...(compact ? { padding: '1px 4px', height: COMPACT_CELL_SIZE } : {}),
                  }}
                >
                  {fmtHeader(rowHeaders[rowIndex][dimIdx], rowDimNames?.[dimIdx])}
                </td>
              ) : null
            )}

            {/* Data cells (interleaved with formula columns if applicable) */}
            {hasColFormulas ? renderDataCells(rowIndex) : (
              cells[rowIndex].map((_value, colIndex) => renderValueCell(rowIndex, colIndex, colIndex))
            )}

            {/* Row total */}
            {showRowTotals && (
              <td
                className={`${NUM_CELL} text-muted-foreground ${compact ? 'text-[10px]' : 'text-sm'}`}
                style={{ borderLeft: '1px solid var(--border)', background: mix(TEAL, 5) }}
              >
                {fmt(rowTotals[rowIndex])}
              </td>
            )}
          </tr>
        )
      })}
    </tbody>
  )
}
