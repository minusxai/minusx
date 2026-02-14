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
  rowDimNames?: string[]
}

type DisplayRow =
  | { type: 'data'; rowIndex: number }
  | { type: 'subtotal'; level: number; label: string; cells: number[]; rowTotal: number }

export const PivotTable = ({
  pivotData,
  showRowTotals = true,
  showColTotals = true,
  showHeatmap = true,
  emptyMessage,
  rowDimNames,
}: PivotTableProps) => {
  const { rowHeaders, columnHeaders, cells, rowTotals, columnTotals, grandTotal, valueLabels } = pivotData

  const hasMultipleValues = valueLabels.length > 1
  const numRowDims = rowHeaders.length > 0 ? rowHeaders[0].length : 0
  const numColDims = columnHeaders.length > 0 ? columnHeaders[0].length : 0
  const numDataCols = cells.length > 0 ? cells[0].length : 0

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

  // Build display rows: interleave data rows with subtotal rows at group boundaries
  const displayRows = useMemo((): DisplayRow[] => {
    if (rowHeaders.length === 0) {
      return cells.map((_, i) => ({ type: 'data' as const, rowIndex: i }))
    }

    // Only add subtotals when there are 2+ row dimensions
    if (numRowDims < 2) {
      return cells.map((_, i) => ({ type: 'data' as const, rowIndex: i }))
    }

    const result: DisplayRow[] = []

    for (let i = 0; i < rowHeaders.length; i++) {
      result.push({ type: 'data', rowIndex: i })

      // Insert subtotals at group boundaries, deepest level first then shallower
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
          // Find start of this group
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

          // Sum cells across the group
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
          })
        }
      }
    }

    return result
  }, [rowHeaders, cells, numRowDims, numDataCols, rowTotals])

  // Build column header rows with colSpan for nested grouping
  const colHeaderRows = useMemo(() => {
    if (columnHeaders.length === 0) return []

    const rows: Array<Array<{ label: string; colSpan: number }>> = []

    for (let level = 0; level < numColDims; level++) {
      const headerRow: Array<{ label: string; colSpan: number }> = []
      let i = 0

      while (i < columnHeaders.length) {
        const currentLabel = columnHeaders[i][level]
        let span = 1

        while (i + span < columnHeaders.length) {
          const matches = columnHeaders[i + span][level] === currentLabel
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

        const effectiveSpan = hasMultipleValues ? span * valueLabels.length : span
        headerRow.push({ label: currentLabel, colSpan: effectiveSpan })
        i += span
      }

      rows.push(headerRow)
    }

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
  // Key: subtotal rows at level S are INCLUDED in the rowSpan of levels 0..S-1
  // This matches the reference UX where parent dim cells span over child subtotals
  const rowSpans = useMemo(() => {
    if (rowHeaders.length === 0 || numRowDims === 0) return []

    const spans: Array<Array<{ show: boolean; rowSpan: number }>> = displayRows.map(() =>
      Array.from({ length: numRowDims }, () => ({ show: true, rowSpan: 1 }))
    )

    for (let level = 0; level < numRowDims; level++) {
      let i = 0
      while (i < displayRows.length) {
        const dr = displayRows[i]

        if (dr.type === 'subtotal') {
          // Subtotals never show individual dim cells - they render their own colSpan label
          spans[i][level] = { show: false, rowSpan: 1 }
          i++
          continue
        }

        // Data row: count span including subtotals at levels STRICTLY GREATER than this level
        let span = 1
        while (i + span < displayRows.length) {
          const next = displayRows[i + span]
          if (next.type === 'subtotal') {
            if (next.level > level) {
              // Include child subtotals in parent's rowSpan
              span++
              continue
            }
            // Subtotal at this level or above breaks the group
            break
          }
          // Data row: check values match at this level and all parents
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
  }, [rowHeaders, numRowDims, displayRows])

  if (cells.length === 0 || (cells.length > 0 && cells[0].length === 0)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || 'No data available for pivot table'}
      </Box>
    )
  }

  // Subtotal styling helpers
  const getSubtotalBg = (level: number) => level === 0 ? 'accent.teal/20' : 'accent.teal/12'
  const getSubtotalBorderTop = (level: number) => level === 0 ? '2px solid' : '1px solid'
  const getSubtotalBorderColor = (level: number) => level === 0 ? 'border.default' : 'border.muted'

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
              {/* Row dimension name headers */}
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
                    borderRight={dimIdx === numRowDims - 1 ? '2px solid' : '1px solid'}
                    borderColor={dimIdx === numRowDims - 1 ? 'border.default' : 'border.muted'}
                    position={dimIdx === 0 ? 'sticky' : undefined}
                    left={dimIdx === 0 ? 0 : undefined}
                    bg="bg.muted"
                    zIndex={dimIdx === 0 ? 3 : undefined}
                    minW="100px"
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
                  color="fg.muted"
                  textAlign="right"
                  borderLeft="2px solid"
                  borderColor="border.default"
                  minW="80px"
                  bg="accent.teal/20"
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
                    borderRight={dimIdx === numRowDims - 1 ? '2px solid' : '1px solid'}
                    borderColor={dimIdx === numRowDims - 1 ? 'border.default' : 'border.muted'}
                    position={dimIdx === 0 ? 'sticky' : undefined}
                    left={dimIdx === 0 ? 0 : undefined}
                    bg="bg.muted"
                    zIndex={dimIdx === 0 ? 3 : undefined}
                    minW="100px"
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
                >
                  Total
                </ChakraTable.ColumnHeader>
              )}
            </ChakraTable.Row>
          )}
        </ChakraTable.Header>

        <ChakraTable.Body>
          {/* Data + subtotal rows */}
          {displayRows.map((displayRow, displayIndex) => {
            if (displayRow.type === 'subtotal') {
              const S = displayRow.level
              const subtotalBg = getSubtotalBg(S)
              const borderTop = getSubtotalBorderTop(S)
              const borderTopColor = getSubtotalBorderColor(S)

              return (
                <ChakraTable.Row key={`subtotal-${displayIndex}`}>
                  {/* Columns 0..S-1 are covered by parent rowSpan - don't render.
                      The label cell starts at column S and spans to the last dim column. */}
                  <ChakraTable.Cell
                    colSpan={numRowDims - S}
                    fontWeight="700"
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    color="fg.default"
                    borderRight="2px solid"
                    borderTop={borderTop}
                    borderBottom={S === 0 ? '2px solid' : undefined}
                    borderColor={borderTopColor}
                    position={S === 0 ? 'sticky' : undefined}
                    left={S === 0 ? 0 : undefined}
                    bg={subtotalBg}
                    zIndex={S === 0 ? 2 : undefined}
                  >
                    {displayRow.label}
                  </ChakraTable.Cell>

                  {/* Subtotal data cells */}
                  {displayRow.cells.map((value, colIndex) => (
                    <ChakraTable.Cell
                      key={colIndex}
                      textAlign="right"
                      fontFamily="mono"
                      fontSize="sm"
                      fontWeight="600"
                      bg={subtotalBg}
                      color="fg.default"
                      borderTop={borderTop}
                      borderBottom={S === 0 ? '2px solid' : undefined}
                      borderColor={borderTopColor}
                    >
                      {formatLargeNumber(value)}
                    </ChakraTable.Cell>
                  ))}

                  {/* Subtotal row total */}
                  {showRowTotals && (
                    <ChakraTable.Cell
                      textAlign="right"
                      fontFamily="mono"
                      fontSize="sm"
                      fontWeight="700"
                      borderLeft="2px solid"
                      borderTop={borderTop}
                      borderBottom={S === 0 ? '2px solid' : undefined}
                      borderColor={borderTopColor}
                      bg={S === 0 ? 'accent.teal/40' : 'accent.teal/30'}
                      color="fg.default"
                    >
                      {formatLargeNumber(displayRow.rowTotal)}
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
                      fontSize="sm"
                      borderRight={dimIdx === numRowDims - 1 ? '2px solid' : '1px solid'}
                      borderColor={dimIdx === numRowDims - 1 ? 'border.default' : 'border.muted'}
                      position={dimIdx === 0 ? 'sticky' : undefined}
                      left={dimIdx === 0 ? 0 : undefined}
                      bg="bg.surface"
                      zIndex={dimIdx === 0 ? 2 : undefined}
                      verticalAlign="top"
                    >
                      {rowHeaders[rowIndex][dimIdx]}
                    </ChakraTable.Cell>
                  ) : null
                )}

                {/* Data cells */}
                {cells[rowIndex].map((value, colIndex) => (
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
                    bg="accent.teal/20"
                    color="fg.default"
                  >
                    {formatLargeNumber(rowTotals[rowIndex])}
                  </ChakraTable.Cell>
                )}
              </ChakraTable.Row>
            )
          })}

          {/* Column totals row */}
          {showColTotals && (
            <ChakraTable.Row fontWeight="600">
              <ChakraTable.Cell
                colSpan={numRowDims || 1}
                fontWeight="700"
                fontSize="xs"
                textTransform="uppercase"
                letterSpacing="0.05em"
                color="fg.default"
                borderRight="2px solid"
                borderTop="2px solid"
                borderColor="border.default"
                position="sticky"
                left={0}
                bg="accent.teal/40"
                zIndex={2}
              >
                Grand Total
              </ChakraTable.Cell>

              {columnTotals.map((total, colIndex) => (
                <ChakraTable.Cell
                  key={colIndex}
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="600"
                  borderTop="2px solid"
                  borderColor="border.default"
                  bg="accent.teal/40"
                  color="fg.default"
                >
                  {formatLargeNumber(total)}
                </ChakraTable.Cell>
              ))}

              {showRowTotals && (
                <ChakraTable.Cell
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="700"
                  color="fg.default"
                  borderLeft="2px solid"
                  borderTop="2px solid"
                  borderColor="border.default"
                  bg="accent.teal/50"
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
