'use client'

import { useMemo } from 'react'
import { Box, Table as ChakraTable } from '@chakra-ui/react'
import { isValidChartData, formatLargeNumber, type ChartProps } from '@/lib/chart/chart-utils'

interface PivotTableProps extends ChartProps {
  emptyMessage?: string
  showRowTotals?: boolean
  showColTotals?: boolean
}

export const PivotTable = ({
  xAxisData,
  series,
  xAxisLabel,
  emptyMessage,
  showRowTotals = true,
  showColTotals = true,
}: PivotTableProps) => {
  // Compute totals and min/max for color gradient
  const { rowTotals, colTotals, grandTotal, minValue, maxValue } = useMemo(() => {
    const rowTotals: number[] = []
    const colTotals: number[] = new Array(series.length).fill(0)
    let grandTotal = 0
    let minValue = Infinity
    let maxValue = -Infinity

    xAxisData.forEach((_, rowIndex) => {
      let rowSum = 0
      series.forEach((s, colIndex) => {
        const value = s.data[rowIndex] || 0
        rowSum += value
        colTotals[colIndex] += value
        // Track min/max for gradient
        if (value < minValue) minValue = value
        if (value > maxValue) maxValue = value
      })
      rowTotals.push(rowSum)
      grandTotal += rowSum
    })

    return { rowTotals, colTotals, grandTotal, minValue, maxValue }
  }, [xAxisData, series])

  // Calculate opacity for a value (50 to 100 range for Chakra color/opacity syntax)
  const getOpacityPercent = (value: number): number => {
    if (maxValue === minValue) return 75
    const normalized = (value - minValue) / (maxValue - minValue)
    return Math.round(10 + normalized * 90)
  }

  if (!isValidChartData(xAxisData, series)) {
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
          <ChakraTable.Row bg="bg.muted">
            {/* Row label header */}
            <ChakraTable.ColumnHeader
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
              minW="120px"
            >
              {xAxisLabel || 'Category'}
            </ChakraTable.ColumnHeader>

            {/* Value column headers */}
            {series.map((s, index) => (
              <ChakraTable.ColumnHeader
                key={index}
                fontWeight="700"
                fontSize="xs"
                textTransform="uppercase"
                letterSpacing="0.05em"
                color="fg.muted"
                textAlign="right"
                minW="100px"
              >
                {s.name}
              </ChakraTable.ColumnHeader>
            ))}

            {/* Row total header */}
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
                minW="100px"
                bg="bg.subtle"
              >
                Total
              </ChakraTable.ColumnHeader>
            )}
          </ChakraTable.Row>
        </ChakraTable.Header>

        <ChakraTable.Body>
          {/* Data rows */}
          {xAxisData.map((rowLabel, rowIndex) => (
            <ChakraTable.Row key={rowIndex} _hover={{ bg: 'bg.muted' }}>
              {/* Row label */}
              <ChakraTable.Cell
                fontWeight="600"
                fontSize="sm"
                borderRight="1px solid"
                borderColor="border.muted"
                position="sticky"
                left={0}
                bg="bg.surface"
                zIndex={1}
              >
                {rowLabel}
              </ChakraTable.Cell>

              {/* Data cells */}
              {series.map((s, colIndex) => {
                const value = s.data[rowIndex] || 0
                const opacityPercent = getOpacityPercent(value)
                return (
                  <ChakraTable.Cell
                    key={colIndex}
                    textAlign="right"
                    fontFamily="mono"
                    fontSize="sm"
                    bg={`accent.teal/${opacityPercent}`}
                  >
                    {formatLargeNumber(value)}
                  </ChakraTable.Cell>
                )
              })}

              {/* Row total */}
              {showRowTotals && (
                <ChakraTable.Cell
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="600"
                  borderLeft="2px solid"
                  borderColor="border.default"
                  bg="bg.subtle"
                >
                  {formatLargeNumber(rowTotals[rowIndex])}
                </ChakraTable.Cell>
              )}
            </ChakraTable.Row>
          ))}

          {/* Column totals row */}
          {showColTotals && (
            <ChakraTable.Row bg="bg.subtle" fontWeight="600">
              {/* Total label */}
              <ChakraTable.Cell
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
                bg="bg.subtle"
                zIndex={1}
              >
                Total
              </ChakraTable.Cell>

              {/* Column totals */}
              {colTotals.map((total, colIndex) => (
                <ChakraTable.Cell
                  key={colIndex}
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="600"
                  borderTop="2px solid"
                  borderColor="border.default"
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
                  bg="bg.muted"
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
