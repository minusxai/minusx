'use client'

import { useState, useMemo, useCallback } from 'react'
import { Box, Table as ChakraTable } from '@chakra-ui/react'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
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
  | { type: 'subtotal'; level: number; label: string; cells: number[]; rowTotal: number; groupValues: string[] }

const makeGroupKey = (values: string[]) => values.join('|||')

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
            groupValues: rowHeaders[i].slice(0, level + 1),
          })
        }
      }
    }

    return result
  }, [rowHeaders, cells, numRowDims, numDataCols, rowTotals])

  // Filter visible rows based on collapsed groups
  const visibleRows = useMemo((): DisplayRow[] => {
    if (collapsedGroups.size === 0 || numRowDims < 2) return displayRows

    return displayRows.filter(dr => {
      if (dr.type === 'data') {
        // A data row is hidden if ANY group it belongs to is collapsed
        for (let level = 0; level < numRowDims - 1; level++) {
          const key = makeGroupKey(rowHeaders[dr.rowIndex].slice(0, level + 1))
          if (collapsedGroups.has(key)) return false
        }
        return true
      }

      if (dr.type === 'subtotal') {
        // A subtotal at level L is hidden if any PARENT group (levels 0..L-1) is collapsed
        for (let parentLevel = 0; parentLevel < dr.level; parentLevel++) {
          const parentKey = makeGroupKey(dr.groupValues.slice(0, parentLevel + 1))
          if (collapsedGroups.has(parentKey)) return false
        }
        // The subtotal at its own level is always visible (serves as collapsed header)
        return true
      }

      return true
    })
  }, [displayRows, collapsedGroups, rowHeaders, numRowDims])

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

        if (dr.type === 'subtotal') {
          spans[i][level] = { show: false, rowSpan: 1 }
          i++
          continue
        }

        // Data row: count span including subtotals at levels STRICTLY GREATER than this level
        let span = 1
        while (i + span < visibleRows.length) {
          const next = visibleRows[i + span]
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
      <ChakraTable.Root size="sm" css={{ borderCollapse: 'collapse' }}>
        <ChakraTable.Header position="sticky" top={0} zIndex={5} bg="bg.muted">
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
                    zIndex={dimIdx === 0 ? 4 : 3}
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
                  zIndex={3}
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
                  zIndex={3}
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
                    zIndex={dimIdx === 0 ? 4 : 3}
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
                  zIndex={3}
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
          {/* Data + subtotal rows */}
          {visibleRows.map((displayRow, displayIndex) => {
            if (displayRow.type === 'subtotal') {
              const S = displayRow.level
              const subtotalBg = getSubtotalBg(S)
              const borderTop = getSubtotalBorderTop(S)
              const borderTopColor = getSubtotalBorderColor(S)
              const groupKey = makeGroupKey(displayRow.groupValues)
              const collapsed = collapsedGroups.has(groupKey)

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
                    cursor="pointer"
                    onClick={() => toggleGroup(groupKey)}
                    _hover={{ opacity: 0.8 }}
                  >
                    <Box display="flex" alignItems="center" gap={1}>
                      <Box as={collapsed ? LuChevronRight : LuChevronDown} fontSize="sm" flexShrink={0} />
                      {displayRow.label}
                    </Box>
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
