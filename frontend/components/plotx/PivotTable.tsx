'use client'

import { useMemo } from 'react'
import { Box, Table as ChakraTable } from '@chakra-ui/react'
import { formatLargeNumber } from '@/lib/chart/chart-utils'
import type { PivotData } from '@/lib/chart/pivot-utils'

interface PivotTableProps {
  pivotData: PivotData
  showRowTotals?: boolean
  showColTotals?: boolean
  showHeatmap?: boolean
  emptyMessage?: string
}

export const PivotTable = ({
  pivotData,
  showRowTotals = true,
  showColTotals = true,
  showHeatmap = true,
  emptyMessage,
}: PivotTableProps) => {
  const { rowHeaders, columnHeaders, cells, rowTotals, columnTotals, grandTotal, valueLabels } = pivotData

  const hasMultipleValues = valueLabels.length > 1
  const numRowDims = rowHeaders.length > 0 ? rowHeaders[0].length : 0
  const numColDims = columnHeaders.length > 0 ? columnHeaders[0].length : 0

  // Compute min/max across all cells for heatmap gradient
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

  const getCellBg = (value: number): string | undefined => {
    if (!showHeatmap) return undefined
    if (maxValue === minValue) return 'accent.teal/75'
    const normalized = (value - minValue) / (maxValue - minValue)
    const opacityPercent = Math.round(10 + normalized * 90)
    return `accent.teal/${opacityPercent}`
  }

  // Build column header rows with colSpan for nested grouping
  const colHeaderRows = useMemo(() => {
    if (columnHeaders.length === 0) return []

    const rows: Array<Array<{ label: string; colSpan: number }>> = []

    // For each dimension level in column headers
    for (let level = 0; level < numColDims; level++) {
      const headerRow: Array<{ label: string; colSpan: number }> = []
      let i = 0

      while (i < columnHeaders.length) {
        const currentLabel = columnHeaders[i][level]
        let span = 1

        // Count consecutive identical labels at this level
        // But only group if all parent levels also match
        while (i + span < columnHeaders.length) {
          const matches = columnHeaders[i + span][level] === currentLabel
          // Check all parent levels match too
          let parentsMatch = true
          for (let p = 0; p < level; p++) {
            if (columnHeaders[i + span][p] !== columnHeaders[i][p]) {
              parentsMatch = false
              break
            }
          }
          if (matches && parentsMatch) {
            span++
          } else {
            break
          }
        }

        // Multiply colSpan by number of value columns if multiple values
        const effectiveSpan = hasMultipleValues ? span * valueLabels.length : span
        headerRow.push({ label: currentLabel, colSpan: effectiveSpan })
        i += span
      }

      rows.push(headerRow)
    }

    // Add value label row if multiple values
    if (hasMultipleValues) {
      const valueRow: Array<{ label: string; colSpan: number }> = []
      for (let c = 0; c < columnHeaders.length; c++) {
        for (const vl of valueLabels) {
          valueRow.push({ label: vl, colSpan: 1 })
        }
      }
      rows.push(valueRow)
    }

    return rows
  }, [columnHeaders, numColDims, hasMultipleValues, valueLabels])

  // Build row header spans for nested grouping
  const rowSpans = useMemo(() => {
    if (rowHeaders.length === 0 || numRowDims === 0) return []

    // For each dimension level, compute rowSpan at each row
    const spans: Array<Array<{ show: boolean; rowSpan: number }>> = rowHeaders.map(() =>
      Array.from({ length: numRowDims }, () => ({ show: true, rowSpan: 1 }))
    )

    for (let level = 0; level < numRowDims; level++) {
      let i = 0
      while (i < rowHeaders.length) {
        let span = 1
        while (i + span < rowHeaders.length) {
          const matches = rowHeaders[i + span][level] === rowHeaders[i][level]
          let parentsMatch = true
          for (let p = 0; p < level; p++) {
            if (rowHeaders[i + span][p] !== rowHeaders[i][p]) {
              parentsMatch = false
              break
            }
          }
          if (matches && parentsMatch) {
            span++
          } else {
            break
          }
        }

        spans[i][level] = { show: true, rowSpan: span }
        for (let j = 1; j < span; j++) {
          spans[i + j][level] = { show: false, rowSpan: 1 }
        }
        i += span
      }
    }

    return spans
  }, [rowHeaders, numRowDims])

  if (cells.length === 0 || (cells.length > 0 && cells[0].length === 0)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || 'No data available for pivot table'}
      </Box>
    )
  }

  return (
    <Box
      width="100%"
      height="100%"
      overflow="auto"
      border="1px solid"
      borderColor="border.muted"
      borderRadius="md"
    >
      <ChakraTable.Root size="sm" stickyHeader>
        <ChakraTable.Header>
          {/* Column header rows */}
          {colHeaderRows.map((headerRow, rowIdx) => (
            <ChakraTable.Row key={rowIdx} bg="bg.muted">
              {/* Empty cells for row dimension headers */}
              {rowIdx === 0 && numRowDims > 0 && (
                Array.from({ length: numRowDims }, (_, dimIdx) => (
                  <ChakraTable.ColumnHeader
                    key={`dim-${dimIdx}`}
                    rowSpan={colHeaderRows.length}
                    fontWeight="700"
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    color="fg.muted"
                    borderRight="1px solid"
                    borderColor="border.muted"
                    position="sticky"
                    left={0}
                    bg="bg.muted"
                    zIndex={2}
                    minW="100px"
                  />
                ))
              )}

              {/* Column headers at this level */}
              {headerRow.map((hdr, colIdx) => (
                <ChakraTable.ColumnHeader
                  key={colIdx}
                  colSpan={hdr.colSpan}
                  fontWeight="700"
                  fontSize="xs"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  color="fg.muted"
                  textAlign="center"
                  minW="80px"
                  borderBottom={rowIdx < colHeaderRows.length - 1 ? '1px solid' : undefined}
                  borderColor="border.muted"
                >
                  {hdr.label}
                </ChakraTable.ColumnHeader>
              ))}

              {/* Row total header */}
              {showRowTotals && rowIdx === 0 && (
                <ChakraTable.ColumnHeader
                  rowSpan={colHeaderRows.length}
                  fontWeight="700"
                  fontSize="xs"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  color="accent.teal"
                  textAlign="right"
                  borderLeft="2px solid"
                  borderColor="border.default"
                  minW="80px"
                  bg="accent.teal/8"
                >
                  Total
                </ChakraTable.ColumnHeader>
              )}
            </ChakraTable.Row>
          ))}

          {/* If no column dimensions, still show a header row with value labels */}
          {colHeaderRows.length === 0 && (
            <ChakraTable.Row bg="bg.muted">
              {numRowDims > 0 && (
                Array.from({ length: numRowDims }, (_, dimIdx) => (
                  <ChakraTable.ColumnHeader
                    key={`dim-${dimIdx}`}
                    fontWeight="700"
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    color="fg.muted"
                    borderRight="1px solid"
                    borderColor="border.muted"
                    position="sticky"
                    left={0}
                    bg="bg.muted"
                    zIndex={2}
                    minW="100px"
                  />
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
                  color="accent.teal"
                  textAlign="right"
                  borderLeft="2px solid"
                  borderColor="border.default"
                  minW="80px"
                  bg="accent.teal/8"
                >
                  Total
                </ChakraTable.ColumnHeader>
              )}
            </ChakraTable.Row>
          )}
        </ChakraTable.Header>

        <ChakraTable.Body>
          {/* Data rows */}
          {cells.map((cellRow, rowIndex) => (
            <ChakraTable.Row key={rowIndex} _hover={{ bg: 'bg.muted' }}>
              {/* Row dimension headers */}
              {rowSpans[rowIndex]?.map((spanInfo, dimIdx) =>
                spanInfo.show ? (
                  <ChakraTable.Cell
                    key={`dim-${dimIdx}`}
                    rowSpan={spanInfo.rowSpan}
                    fontWeight="600"
                    fontSize="sm"
                    borderRight={dimIdx === numRowDims - 1 ? '1px solid' : undefined}
                    borderColor="border.muted"
                    position="sticky"
                    left={0}
                    bg="bg.surface"
                    zIndex={1}
                    verticalAlign="top"
                  >
                    {rowHeaders[rowIndex][dimIdx]}
                  </ChakraTable.Cell>
                ) : null
              )}

              {/* Data cells */}
              {cellRow.map((value, colIndex) => (
                <ChakraTable.Cell
                  key={colIndex}
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  bg={getCellBg(value)}
                >
                  {formatLargeNumber(value)}
                </ChakraTable.Cell>
              ))}

              {/* Row total */}
              {showRowTotals && (
                <ChakraTable.Cell
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="600"
                  borderLeft="2px solid"
                  borderColor="border.default"
                  bg="accent.teal/8"
                  color="accent.teal"
                >
                  {formatLargeNumber(rowTotals[rowIndex])}
                </ChakraTable.Cell>
              )}
            </ChakraTable.Row>
          ))}

          {/* Column totals row */}
          {showColTotals && (
            <ChakraTable.Row fontWeight="600">
              {/* Total label - spans all row dimension columns */}
              <ChakraTable.Cell
                colSpan={numRowDims || 1}
                fontWeight="700"
                fontSize="xs"
                textTransform="uppercase"
                letterSpacing="0.05em"
                color="accent.teal"
                borderRight="1px solid"
                borderTop="2px solid"
                borderColor="border.default"
                position="sticky"
                left={0}
                bg="accent.teal/8"
                zIndex={1}
              >
                Total
              </ChakraTable.Cell>

              {/* Column totals */}
              {columnTotals.map((total, colIndex) => (
                <ChakraTable.Cell
                  key={colIndex}
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="600"
                  borderTop="2px solid"
                  borderColor="border.default"
                  bg="accent.teal/8"
                  color="accent.teal"
                >
                  {formatLargeNumber(total)}
                </ChakraTable.Cell>
              ))}

              {/* Grand total */}
              {showRowTotals && (
                <ChakraTable.Cell
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="700"
                  color="accent.teal"
                  borderLeft="2px solid"
                  borderTop="2px solid"
                  borderColor="border.default"
                  bg="accent.teal/15"
                >
                  {formatLargeNumber(grandTotal)}
                </ChakraTable.Cell>
              )}
            </ChakraTable.Row>
          )}
        </ChakraTable.Body>
      </ChakraTable.Root>
    </Box>
  )
}
