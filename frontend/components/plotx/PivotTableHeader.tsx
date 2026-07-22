'use client'

import { LuSquareFunction } from 'react-icons/lu'

interface HeaderCell {
  label: string
  colSpan: number
  rowSpan?: number
  isFormula?: boolean
}

// Table header rows (column dimension headers + formula column headers). Native <thead>/<th>
// on the kit/Tailwind stack (Renderer_v2 Phase 3) — same DOM + stable class contract
// (.mx-header-row/.mx-th) as before; only the styling system changed.
interface PivotTableHeaderProps {
  augmentedColHeaderRows: HeaderCell[][]
  numRowDims: number
  numHeaderRows: number
  rowDimNames?: string[]
  showRowTotals: boolean
  compact: boolean
  getLeftOffset: (dimIdx: number) => number
  isLastDim: (dimIdx: number) => boolean
  ROW_DIM_COL_W: number
  COMPACT_CELL_SIZE: number
  valueLabels: string[]
}

const TH_BASE = 'mx-th font-bold uppercase text-muted-foreground'

export const PivotTableHeader = ({
  augmentedColHeaderRows,
  numRowDims,
  numHeaderRows,
  rowDimNames,
  showRowTotals,
  compact,
  getLeftOffset,
  isLastDim,
  ROW_DIM_COL_W,
  COMPACT_CELL_SIZE,
  valueLabels,
}: PivotTableHeaderProps) => {
  const dimTh = (dimIdx: number, rowSpan?: number) => (
    <th
      className={`${TH_BASE} sticky z-[4] bg-muted text-left ${compact ? 'font-mono text-[10px]' : 'text-xs tracking-wider'}`}
      key={`dim-${dimIdx}`}
      rowSpan={rowSpan}
      style={{
        left: `${getLeftOffset(dimIdx)}px`,
        width: ROW_DIM_COL_W, minWidth: ROW_DIM_COL_W, maxWidth: ROW_DIM_COL_W,
        borderRight: isLastDim(dimIdx) ? undefined : '1px solid var(--border)',
        ...(compact ? { padding: '1px 4px' } : {}),
      }}
    >
      {rowDimNames?.[dimIdx] || ''}
    </th>
  )

  const totalTh = (rowSpan?: number) => (
    <th
      className={`${TH_BASE} z-[3] min-w-[80px] text-right text-xs tracking-wider`}
      rowSpan={rowSpan}
      style={{ borderLeft: '2px solid var(--border)', background: 'color-mix(in srgb, #16a085 20%, transparent)' }}
    >
      Total
    </th>
  )

  return (
    <thead className="sticky top-0 z-[5] bg-muted">
      {/* Column header rows */}
      {augmentedColHeaderRows.map((headerRow, rowIdx) => (
        <tr key={rowIdx} className="mx-header-row bg-muted">
          {/* Row dimension name headers */}
          {rowIdx === 0 && numRowDims > 0 &&
            Array.from({ length: numRowDims }, (_, dimIdx) => dimTh(dimIdx, numHeaderRows))}

          {/* Column headers at this level */}
          {headerRow.map((hdr, colIdx) => (
            <th
              className={`mx-th z-[3] text-center font-bold ${compact ? 'text-[10px]' : 'text-xs tracking-wider'} ${
                hdr.isFormula ? 'italic text-[#9b59b6]' : compact ? 'text-foreground' : 'text-muted-foreground'
              }`}
              key={colIdx}
              colSpan={hdr.colSpan}
              rowSpan={hdr.rowSpan}
              style={{
                minWidth: compact ? COMPACT_CELL_SIZE : 80,
                borderBottom: rowIdx < numHeaderRows - 1 ? '1px solid var(--border)' : undefined,
                background: hdr.isFormula ? 'color-mix(in srgb, #9b59b6 12%, transparent)' : 'var(--muted)',
                ...(compact ? { paddingLeft: 0, paddingRight: 0, paddingTop: 4, paddingBottom: 4, width: COMPACT_CELL_SIZE } : {}),
              }}
            >
              {compact ? (
                <span className="flex w-full justify-center">
                  <span
                    className="whitespace-nowrap font-mono text-[10px] leading-none"
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
                  >
                    {hdr.label}
                  </span>
                </span>
              ) : hdr.isFormula ? (
                <span className="inline-flex items-center justify-center gap-1">
                  <LuSquareFunction className="text-base text-[#9b59b6]" />
                  {hdr.label}
                </span>
              ) : hdr.label}
            </th>
          ))}

          {/* Row total header */}
          {showRowTotals && rowIdx === 0 && totalTh(numHeaderRows)}
        </tr>
      ))}

      {/* If no column dimensions, still show a header row with value labels */}
      {augmentedColHeaderRows.length === 0 && (
        <tr className="mx-header-row bg-muted">
          {numRowDims > 0 &&
            Array.from({ length: numRowDims }, (_, dimIdx) => dimTh(dimIdx))}
          {valueLabels.map((vl, i) => (
            <th
              className={`${TH_BASE} z-[3] min-w-[80px] bg-muted text-right text-xs tracking-wider`}
              key={i}
            >
              {vl}
            </th>
          ))}
          {showRowTotals && totalTh()}
        </tr>
      )}
    </thead>
  )
}
