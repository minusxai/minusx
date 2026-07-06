'use client'

import { Box } from '@chakra-ui/react'

// Compact-mode tooltip content for a pivot cell, extracted verbatim from
// PivotTable.tsx's buildTooltipContent callback (pure code motion, no logic change).
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
    <Box fontFamily="mono" fontSize="xs">
      {dims.length > 0 && (
        <Box fontWeight="600" mb={1}>
          {dims.map(d => d.value).join(' · ')}
        </Box>
      )}
      <Box display="flex" alignItems="center" gap={2}>
        <Box w="10px" h="10px" borderRadius="full" flexShrink={0} bg={cellBg ?? 'fg.subtle'} />
        <Box color="fg.muted">{valueLabels[valueIndex ?? 0] || 'Value'}</Box>
        <Box fontWeight="700" ml="auto" color={present ? undefined : 'fg.subtle'}>{formattedValue}</Box>
      </Box>
    </Box>
  )
}
