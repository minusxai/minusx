'use client'

import { Box, Table as ChakraTable, Icon } from '@chakra-ui/react'
import { LuSquareFunction } from 'react-icons/lu'

interface HeaderCell {
  label: string
  colSpan: number
  rowSpan?: number
  isFormula?: boolean
}

// Table header rows (column dimension headers + formula column headers),
// extracted verbatim from PivotTable.tsx's <ChakraTable.Header> block
// (pure code motion, no logic change).
interface PivotTableHeaderProps {
  augmentedColHeaderRows: HeaderCell[][]
  numRowDims: number
  numHeaderRows: number
  rowDimNames?: string[]
  showRowTotals: boolean
  compact: boolean
  headerBg: string
  getLeftOffset: (dimIdx: number) => number
  isLastDim: (dimIdx: number) => boolean
  ROW_DIM_COL_W: number
  COMPACT_CELL_SIZE: number
  valueLabels: string[]
}

export const PivotTableHeader = ({
  augmentedColHeaderRows,
  numRowDims,
  numHeaderRows,
  rowDimNames,
  showRowTotals,
  compact,
  headerBg,
  getLeftOffset,
  isLastDim,
  ROW_DIM_COL_W,
  COMPACT_CELL_SIZE,
  valueLabels,
}: PivotTableHeaderProps) => {
  return (
    <ChakraTable.Header position="sticky" top={0} zIndex={5} bg={headerBg}>
      {/* Column header rows */}
      {augmentedColHeaderRows.map((headerRow, rowIdx) => (
        <ChakraTable.Row key={rowIdx} className="mx-header-row" bg={headerBg}>
          {/* Row dimension name headers */}
          {rowIdx === 0 && numRowDims > 0 && (
            Array.from({ length: numRowDims }, (_, dimIdx) => (
              <ChakraTable.ColumnHeader
              className="mx-th"
                key={`dim-${dimIdx}`}
                rowSpan={numHeaderRows}
                fontWeight="700"
                fontSize={compact ? '2xs' : 'xs'}
                fontFamily={compact ? 'mono' : undefined}
                textTransform="uppercase"
                letterSpacing={compact ? undefined : '0.05em'}
                color="fg.muted"
                borderRight={isLastDim(dimIdx) ? undefined : '1px solid'}
                borderColor="border.muted"

                position="sticky"
                left={`${getLeftOffset(dimIdx)}px`}
                bg={headerBg}
                zIndex={4}
                w={`${ROW_DIM_COL_W}px`}
                minW={`${ROW_DIM_COL_W}px`}
                maxW={`${ROW_DIM_COL_W}px`}
                {...(compact ? { p: '1px 4px' } : {})}
              >
                {rowDimNames?.[dimIdx] || ''}
              </ChakraTable.ColumnHeader>
            ))
          )}

          {/* Column headers at this level */}
          {headerRow.map((hdr, colIdx) => (
            <ChakraTable.ColumnHeader
              className="mx-th"
              key={colIdx}
              colSpan={hdr.colSpan}
              rowSpan={hdr.rowSpan}
              fontWeight="700"
              fontSize={compact ? '2xs' : 'xs'}
              textTransform="uppercase"
              letterSpacing={compact ? undefined : '0.05em'}
              color={hdr.isFormula ? 'accent.secondary' : compact ? 'fg.default' : 'fg.muted'}
              textAlign="center"
              minW={compact ? `${COMPACT_CELL_SIZE}px` : '80px'}
              borderBottom={rowIdx < numHeaderRows - 1 ? '1px solid' : undefined}
              borderColor="border.muted"
              zIndex={3}
              bg={hdr.isFormula ? 'accent.secondary/12' : 'bg.muted'}
              fontStyle={hdr.isFormula ? 'italic' : undefined}
              {...(compact ? { px: 0, py: '4px', w: `${COMPACT_CELL_SIZE}px` } : {})}
            >
              {compact ? (
                <Box display="flex" justifyContent="center" w="100%">
                  <Box
                    css={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                    transform="rotate(180deg)"
                    fontSize="2xs"
                    fontFamily="mono"
                    whiteSpace="nowrap"
                    lineHeight={1}
                  >
                    {hdr.label}
                  </Box>
                </Box>
              ) : hdr.isFormula ? (
                <Box display="inline-flex" alignItems="center" gap={1} justifyContent="center">
                  <Icon fontSize="md" color="accent.secondary">
                    <LuSquareFunction />
                  </Icon>

                  {hdr.label}
                </Box>
              ) : hdr.label}
            </ChakraTable.ColumnHeader>
          ))}

          {/* Row total header */}
          {showRowTotals && rowIdx === 0 && (
            <ChakraTable.ColumnHeader
              className="mx-th"
              rowSpan={numHeaderRows}
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
      {augmentedColHeaderRows.length === 0 && (
        <ChakraTable.Row className="mx-header-row" bg={headerBg}>
          {numRowDims > 0 && (
            Array.from({ length: numRowDims }, (_, dimIdx) => (
              <ChakraTable.ColumnHeader
              className="mx-th"
                key={`dim-${dimIdx}`}
                fontWeight="700"
                fontSize="xs"
                textTransform="uppercase"
                letterSpacing="0.05em"
                color="fg.muted"
                borderRight={isLastDim(dimIdx) ? undefined : '1px solid'}
                borderColor="border.muted"

                position="sticky"
                left={`${getLeftOffset(dimIdx)}px`}
                bg={headerBg}
                zIndex={4}
                w={`${ROW_DIM_COL_W}px`}
                minW={`${ROW_DIM_COL_W}px`}
                maxW={`${ROW_DIM_COL_W}px`}
              >
                {rowDimNames?.[dimIdx] || ''}
              </ChakraTable.ColumnHeader>
            ))
          )}
          {valueLabels.map((vl, i) => (
            <ChakraTable.ColumnHeader
              className="mx-th"
              key={i}
              fontWeight="700"
              fontSize="xs"
              textTransform="uppercase"
              letterSpacing="0.05em"
              color="fg.muted"
              textAlign="right"
              minW="80px"
              zIndex={3}
              bg={headerBg}
            >
              {vl}
            </ChakraTable.ColumnHeader>
          ))}
          {showRowTotals && (
            <ChakraTable.ColumnHeader
              className="mx-th"
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
  )
}
