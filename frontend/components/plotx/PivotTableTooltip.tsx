'use client'

// Compact-mode tooltip content for a pivot cell. Native/Tailwind on the kit stack
// (Renderer_v2 Phase 3) — same content structure as the Chakra original.
interface PivotTableTooltipContentProps {
  value: number
  rowIndex: number
  cellIndex: number
  valueIndex?: number
  present?: boolean
  rowHeaders: string[][]
  columnHeaders: string[][]
  rowDimNames?: string[]
  colDimNames?: string[]
  numValues: number
  valueLabels: string[]
  fmtHeader: (value: string, dimName?: string) => string
  fmt: (value: number, valueIndex?: number) => string
  getCellBg: (value: number, present?: boolean) => string | undefined
}

export const PivotTableTooltipContent = ({
  value,
  rowIndex,
  cellIndex,
  valueIndex,
  present = true,
  rowHeaders,
  columnHeaders,
  rowDimNames,
  colDimNames,
  numValues,
  valueLabels,
  fmtHeader,
  fmt,
  getCellBg,
}: PivotTableTooltipContentProps) => {
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
  const formattedValue = present ? fmt(value, valueIndex) : 'No data'
  const cellBg = getCellBg(value, present)
  return (
    <div className="font-mono text-xs">
      {dims.length > 0 && (
        <div className="mb-1 font-semibold">
          {dims.map(d => d.value).join(' · ')}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: cellBg ?? 'var(--muted-foreground)' }}
        />
        <span className="opacity-75">{valueLabels[valueIndex ?? 0] || 'Value'}</span>
        <span className={`ml-auto font-bold ${present ? '' : 'opacity-60'}`}>{formattedValue}</span>
      </div>
    </div>
  )
}
