'use client'

import { Box, Table as ChakraTable, Icon } from '@chakra-ui/react'
import { Tooltip } from '@/components/ui/tooltip'
import { LuChevronUp, LuChevronRight, LuSquareFunction } from 'react-icons/lu'
import type { FormulaResults } from '@/lib/chart/pivot-utils'

type DisplayRow =
  | { type: 'data'; rowIndex: number }
  | { type: 'subtotal'; level: number; label: string; cells: number[]; rowTotal: number; groupValues: string[] }
  | { type: 'formula-row'; name: string; cells: number[]; rowTotal: number; dimensionLevel?: number; parentValues?: string[] }

type ColEntry =
  | { type: 'data'; cellIndex: number }
  | { type: 'formula-col'; formulaIdx: number; valueIdx: number }

// Shared with PivotTable.tsx (imported back from there) so both files use
// the exact same group-key encoding.
export const makeGroupKey = (values: string[]) => values.join('|||')

// Styling helpers for subtotal rows, extracted verbatim from PivotTable.tsx.
const getSubtotalBg = (level: number) => level === 0 ? 'accent.teal/20' : 'accent.teal/12'
const getSubtotalBorderTop = (level: number) => level === 0 ? '1px solid' : '1px solid'
const getSubtotalBorderColor = (level: number) => level === 0 ? 'border.subtle' : 'border.muted'

// Table body (data + subtotal + formula rows), extracted verbatim from
// PivotTable.tsx's renderDataCells/renderSubtotalCells/renderFormulaRowCells
// helpers and its <ChakraTable.Body> block (pure code motion, no logic change).
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
  getCellBg: (value: number, present?: boolean) => string | undefined
  isPresent: (r: number, c: number) => boolean
  handlePivotCellClick: (rowIndex: number, cellIndex: number, event: React.MouseEvent) => void
  buildTooltipContent: (value: number, rowIndex: number, cellIndex: number, valueIndex?: number, present?: boolean) => React.ReactNode
  collapsedGroups: Set<string>
  toggleGroup: (groupKey: string) => void
  headerBg: string
  getLeftOffset: (dimIdx: number) => number
  isLastDim: (dimIdx: number) => boolean
  ROW_DIM_COL_W: number
  COMPACT_CELL_SIZE: number
  tooltipContentProps: React.ComponentProps<typeof Tooltip>['contentProps']
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
  isPresent,
  handlePivotCellClick,
  buildTooltipContent,
  collapsedGroups,
  toggleGroup,
  headerBg,
  getLeftOffset,
  isLastDim,
  ROW_DIM_COL_W,
  COMPACT_CELL_SIZE,
  tooltipContentProps,
}: PivotTableBodyProps) => {
  // Helper: render cells for a row using columnEntries
  const renderDataCells = (rowIndex: number) => {
    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        const value = cells[rowIndex][entry.cellIndex]
        const present = isPresent(rowIndex, entry.cellIndex)
        const cellContent = compact ? null : (present ? fmt(value, entry.cellIndex % numValues) : '')
        const cell = (
          <ChakraTable.Cell
            key={`col-${i}`}
            textAlign="right"
            fontFamily="mono"
            fontSize={compact ? '2xs' : 'sm'}
            bg={getCellBg(value, present)}
            cursor="pointer"
            onClick={(e) => handlePivotCellClick(rowIndex, entry.cellIndex, e)}
            _hover={{ outline: '2px solid', outlineColor: 'accent.teal', outlineOffset: '-2px' }}
            {...(compact ? { p: 0, w: `${COMPACT_CELL_SIZE}px`, minW: `${COMPACT_CELL_SIZE}px`, maxW: `${COMPACT_CELL_SIZE}px`, h: `${COMPACT_CELL_SIZE}px` } : {})}
          >
            {cellContent}
          </ChakraTable.Cell>
        )
        if (compact) {
          return (
            <Tooltip key={`col-${i}`} content={buildTooltipContent(value, rowIndex, entry.cellIndex, entry.cellIndex % numValues, present)} positioning={{ placement: 'top' }} contentProps={tooltipContentProps}>
              {cell}
            </Tooltip>
          )
        }
        return cell
      }
      // formula-col
      const val = colFormulas[entry.formulaIdx].rowValues[rowIndex][entry.valueIdx]
      return (
        <ChakraTable.Cell
          key={`col-${i}`}
          textAlign="right"
          fontFamily="mono"
          fontSize={compact ? '2xs' : 'sm'}
          bg="accent.secondary/12"
          fontStyle="italic"
          {...(compact ? { p: 0, w: `${COMPACT_CELL_SIZE}px`, minW: `${COMPACT_CELL_SIZE}px`, maxW: `${COMPACT_CELL_SIZE}px`, h: `${COMPACT_CELL_SIZE}px` } : {})}
        >
          {compact ? null : fmt(val, entry.valueIdx)}
        </ChakraTable.Cell>
      )
    })
  }

  const renderSubtotalCells = (dr: Extract<DisplayRow, { type: 'subtotal' }>) => {
    const subtotalBg = getSubtotalBg(dr.level)
    const borderTop = getSubtotalBorderTop(dr.level)
    const borderTopColor = getSubtotalBorderColor(dr.level)
    const groupKey = makeGroupKey(dr.groupValues)

    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return (
          <ChakraTable.Cell
            key={`col-${i}`}
            textAlign="right"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="600"
            bg={subtotalBg}
            color="fg.default"
            borderTop={borderTop}
            borderBottom={dr.level === 0 ? '1px solid' : undefined}
            borderColor={borderTopColor}
          >
            {fmt(dr.cells[entry.cellIndex], entry.cellIndex % numValues)}
          </ChakraTable.Cell>
        )
      }
      // formula-col in subtotal row
      const vals = colFormulas[entry.formulaIdx].subtotalValues.get(groupKey)
      const val = vals?.[entry.valueIdx]
      return (
        <ChakraTable.Cell
          key={`col-${i}`}
          textAlign="right"
          fontFamily="mono"
          fontSize="sm"
          fontWeight="600"
          bg="accent.secondary/12"
          fontStyle="italic"
          color="fg.default"
          borderTop={borderTop}
          borderBottom={dr.level === 0 ? '1px solid' : undefined}
          borderColor={borderTopColor}
        >
          {val !== undefined ? fmt(val, entry.valueIdx) : '—'}
        </ChakraTable.Cell>
      )
    })
  }

  const renderFormulaRowCells = (dr: Extract<DisplayRow, { type: 'formula-row' }>) => {
    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return (
          <ChakraTable.Cell
            key={`col-${i}`}
            textAlign="right"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="600"
            fontStyle="italic"
            color="fg.default"
            bg="accent.secondary/8"
          >
            {fmt(dr.cells[entry.cellIndex], entry.cellIndex % numValues)}
          </ChakraTable.Cell>
        )
      }
      // formula-col in formula-row: show dash
      return (
        <ChakraTable.Cell
          key={`col-${i}`}
          textAlign="center"
          fontFamily="mono"
          fontSize="sm"
          color="fg.subtle"
          bg="accent.secondary/8"
        >
          {'—'}
        </ChakraTable.Cell>
      )
    })
  }

  return (
    <ChakraTable.Body>
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
            <ChakraTable.Row key={`formula-${displayIndex}`}>
              <ChakraTable.Cell
                colSpan={headerColSpan}
                fontWeight="600"
                fontSize="sm"
                fontStyle="italic"
                color="accent.secondary"
                css={{ background: 'linear-gradient(var(--chakra-colors-accent-secondary/.12), var(--chakra-colors-accent-secondary/.12)), var(--chakra-colors-bg-muted)' }}
                borderRight="1px solid"
                borderColor="fg.muted"

                position="sticky"
                left={isSubLevel ? `${getLeftOffset(formulaDimLevel)}px` : 0}
                zIndex={2}
              >
                <Box display="flex" alignItems="center" gap={1}>
                  <Icon fontSize="sm" color="accent.secondary" flexShrink={0}>
                    <LuSquareFunction />
                  </Icon>
                  {displayRow.name}
                </Box>
              </ChakraTable.Cell>

              {hasColFormulas ? renderFormulaRowCells(displayRow) : (
                displayRow.cells.map((value, colIndex) => (
                  <ChakraTable.Cell
                    key={colIndex}
                    textAlign="right"
                    fontFamily="mono"
                    fontSize="sm"
                    fontWeight="600"
                    fontStyle="italic"
                    color="fg.default"
                    bg="accent.secondary/8"
                  >
                    {fmt(value, colIndex % numValues)}
                  </ChakraTable.Cell>
                ))
              )}

              {showRowTotals && (
                <ChakraTable.Cell
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="700"
                  fontStyle="italic"
                  borderLeft="2px solid"
                  borderColor="border.default"
                  bg="accent.secondary/12"
                  color="accent.secondary"
                >
                  {fmt(displayRow.rowTotal)}
                </ChakraTable.Cell>
              )}
            </ChakraTable.Row>
          )
        }

        // Subtotal row
        if (displayRow.type === 'subtotal') {
          const S = displayRow.level
          const subtotalBg = getSubtotalBg(S)
          const borderTop = getSubtotalBorderTop(S)
          const borderTopColor = getSubtotalBorderColor(S)
          const groupKey = makeGroupKey(displayRow.groupValues)
          const collapsed = collapsedGroups.has(groupKey)

          return (
            <ChakraTable.Row key={`subtotal-${displayIndex}`}>
              <ChakraTable.Cell
                colSpan={numRowDims - S}
                fontWeight="700"
                fontSize="xs"
                textTransform="uppercase"
                letterSpacing="0.05em"
                color="fg.default"
                borderTop={borderTop}
                borderBottom={S === 0 ? '1px solid' : undefined}
                borderColor={borderTopColor}

                position="sticky"
                left={`${getLeftOffset(S)}px`}
                bg={headerBg}
                zIndex={2}
                cursor="pointer"
                onClick={() => toggleGroup(groupKey)}
                _hover={{ opacity: 0.8 }}
              >
                <Box display="flex" alignItems="center" gap={1}>
                  <Box as={collapsed ? LuChevronRight : LuChevronUp} fontSize="sm" flexShrink={0} />
                  {displayRow.label}
                </Box>
              </ChakraTable.Cell>

              {hasColFormulas ? renderSubtotalCells(displayRow) : (
                displayRow.cells.map((value, colIndex) => (
                  <ChakraTable.Cell
                    key={colIndex}
                    textAlign="right"
                    fontFamily="mono"
                    fontSize="sm"
                    fontWeight="600"
                    bg={subtotalBg}
                    color="fg.default"
                    borderTop={borderTop}
                    borderBottom={S === 0 ? '1px solid' : undefined}
                    borderColor={borderTopColor}
                  >
                    {fmt(value, colIndex % numValues)}
                  </ChakraTable.Cell>
                ))
              )}

              {showRowTotals && (
                <ChakraTable.Cell
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="700"
                  borderLeft="2px solid"
                  borderTop={borderTop}
                  borderBottom={S === 0 ? '1px solid' : undefined}
                  borderColor={borderTopColor}
                  bg={S === 0 ? 'accent.teal/40' : 'accent.teal/30'}
                  color="fg.default"
                >
                  {fmt(displayRow.rowTotal)}
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
                  fontSize={compact ? '2xs' : 'sm'}
                  fontFamily={compact ? 'mono' : undefined}
                  borderRight={isLastDim(dimIdx) ? undefined : '1px solid'}
                  borderColor="border.muted"

                  position="sticky"
                  left={`${getLeftOffset(dimIdx)}px`}
                  bg={headerBg}
                  zIndex={2}
                  verticalAlign="top"
                  w={`${ROW_DIM_COL_W}px`}
                  minW={`${ROW_DIM_COL_W}px`}
                  maxW={`${ROW_DIM_COL_W}px`}
                  {...(compact ? { p: '1px 4px', whiteSpace: 'nowrap', h: `${COMPACT_CELL_SIZE}px` } : {})}
                >
                  {fmtHeader(rowHeaders[rowIndex][dimIdx], rowDimNames?.[dimIdx])}
                </ChakraTable.Cell>
              ) : null
            )}

            {/* Data cells (interleaved with formula columns if applicable) */}
            {hasColFormulas ? renderDataCells(rowIndex) : (
              cells[rowIndex].map((value, colIndex) => {
                const present = isPresent(rowIndex, colIndex)
                const cell = (
                  <ChakraTable.Cell
                    key={colIndex}
                    textAlign="right"
                    fontFamily="mono"
                    fontSize={compact ? '2xs' : 'sm'}
                    bg={getCellBg(value, present)}
                    cursor="pointer"
                    onClick={(e) => handlePivotCellClick(rowIndex, colIndex, e)}
                    _hover={{ outline: '2px solid', outlineColor: 'accent.teal', outlineOffset: '-2px' }}
                    {...(compact ? { p: 0, w: `${COMPACT_CELL_SIZE}px`, minW: `${COMPACT_CELL_SIZE}px`, maxW: `${COMPACT_CELL_SIZE}px`, h: `${COMPACT_CELL_SIZE}px` } : {})}
                  >
                    {compact ? null : (present ? fmt(value, colIndex % numValues) : '')}
                  </ChakraTable.Cell>
                )
                if (compact) {
                  return (
                    <Tooltip key={colIndex} content={buildTooltipContent(value, rowIndex, colIndex, colIndex % numValues, present)} positioning={{ placement: 'top' }} contentProps={tooltipContentProps}>
                      {cell}
                    </Tooltip>
                  )
                }
                return cell
              })
            )}

            {/* Row total */}
            {showRowTotals && (
              <ChakraTable.Cell
                textAlign="right"
                fontFamily="mono"
                fontSize={compact ? '2xs' : 'sm'}
                borderLeft="1px solid"
                borderColor="border.default"
                bg="accent.teal/5"
                color="fg.subtle"
              >
                {fmt(rowTotals[rowIndex])}
              </ChakraTable.Cell>
            )}
          </ChakraTable.Row>
        )
      })}
    </ChakraTable.Body>
  )
}
