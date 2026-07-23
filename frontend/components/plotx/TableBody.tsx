import type { Row } from '@tanstack/react-table'
import type { VirtualItem } from '@tanstack/react-virtual'
import { getContrastText } from '@/lib/chart/conditional-format-utils'
import { ROW_HEIGHT, cssColumnClass, type ColumnType } from './table-v2-utils'

interface TableBodyProps {
  enableDrilldown?: boolean
  handleBodyClick: (e: React.MouseEvent<HTMLTableSectionElement>) => void
  virtualItems: VirtualItem[]
  totalSize: number
  tableRows: Row<Record<string, any>>[]
  visibleColIds: string[]
  colSizes: Record<string, number>
  wrapColumns?: ReadonlySet<string>
  onRowClick?: (row: Record<string, any>, index: number) => void
  getCellBg: (row: Record<string, any>, colId: string) => string | undefined
  renderCell?: (colId: string, value: any, row: Record<string, any>) => React.ReactNode | undefined
  formatCell: (col: string, value: any, type: ColumnType) => string
  columnTypes: ColumnType[]
  colIndexMap: Record<string, number>
}

/** Virtualized table body — native <tbody>/<tr>/<td> elements + event delegation
 * (single click handler on the tbody) for performance on large row counts. */
export const TableBody = ({
  enableDrilldown,
  handleBodyClick,
  virtualItems,
  totalSize,
  tableRows,
  visibleColIds,
  colSizes,
  wrapColumns,
  onRowClick,
  getCellBg,
  renderCell,
  formatCell,
  columnTypes,
  colIndexMap,
}: TableBodyProps) => {
  return (
    <tbody onClick={enableDrilldown ? handleBodyClick : undefined}>
      {virtualItems.length > 0 && virtualItems[0].start > 0 && (
        <tr><td style={{ height: virtualItems[0].start, padding: 0 }} /></tr>
      )}
      {virtualItems.map((virtualRow) => {
        const row = tableRows[virtualRow.index]
        const original = row.original
        const lastColIdx = visibleColIds.length - 1
        return (
          <tr
            key={row.id}
            data-row-idx={virtualRow.index}
            // mx-* is the STABLE class contract (css overrides); table-v2-row is internal.
            // Zebra parity rides DATA-index classes (virtualization spacers break
            // nth-child) — the stripe itself is a CSS default in TableV2, overridable.
            className={`table-v2-row mx-row ${virtualRow.index % 2 === 1 ? 'mx-row-odd' : 'mx-row-even'}`}
            style={{
              height: wrapColumns?.size ? undefined : ROW_HEIGHT,
              cursor: onRowClick ? 'pointer' : undefined,
            }}
            onClick={onRowClick ? () => onRowClick(original, virtualRow.index) : undefined}
          >
            {visibleColIds.map((colId, cellIdx) => {
              const shouldWrap = wrapColumns?.has(colId)
              const cellBg = getCellBg(original, colId)
              return (
                <td
                  key={colId}
                  data-col-id={colId}
                  className={`table-v2-cell mx-cell ${cssColumnClass(colId)}`}
                  style={{
                    width: colSizes[colId],
                    borderRight: cellIdx < lastColIdx ? '1px solid var(--border)' : undefined,
                    ...(cellBg ? { backgroundColor: cellBg, color: getContrastText(cellBg) } : undefined),
                    ...(shouldWrap ? { whiteSpace: 'normal', wordBreak: 'break-word' } : undefined),
                  }}
                >
                  {renderCell?.(colId, original[colId], original) ?? formatCell(colId, original[colId], columnTypes[colIndexMap[colId]])}
                </td>
              )
            })}
          </tr>
        )
      })}
      {virtualItems.length > 0 && totalSize - virtualItems[virtualItems.length - 1].end > 0 && (
        <tr><td style={{ height: totalSize - virtualItems[virtualItems.length - 1].end, padding: 0 }} /></tr>
      )}
    </tbody>
  )
}
