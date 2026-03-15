import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react'
import { LuTrendingUp, LuTrendingDown, LuMinus } from 'react-icons/lu'
import { CHART_COLORS } from '@/lib/chart/echarts-theme'
import { formatNumber } from '@/lib/chart/chart-utils'
import { useRef, useState, useEffect } from 'react'
import type { ColumnFormatConfig } from '@/lib/types'

interface TrendPlotProps {
  series: Array<{ name: string; data: number[] }>
  columnFormats?: Record<string, ColumnFormatConfig>
  yAxisColumns?: string[]
}

type SizeMode = 'lg' | 'sm'

function useSizeMode(ref: React.RefObject<HTMLDivElement | null>): SizeMode {
  const [mode, setMode] = useState<SizeMode>('lg')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const { height } = entries[0].contentRect
      setMode(height < 200 ? 'sm' : 'lg')
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return mode
}

export const TrendPlot = ({ series, columnFormats, yAxisColumns }: TrendPlotProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const mode = useSizeMode(containerRef)

  if (!series || series.length === 0) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        No data to display
      </Box>
    )
  }

  // Get colors for each metric
  const colors = [
    CHART_COLORS.teal,
    CHART_COLORS.primary,
    CHART_COLORS.purple,
    CHART_COLORS.success,
    CHART_COLORS.warning,
    CHART_COLORS.danger,
  ]

  const isSmall = mode === 'sm'

  return (
    <Box
      ref={containerRef}
      display="flex"
      alignItems="center"
      justifyContent="center"
      height="100%"
      overflow="hidden"
    >
      <HStack gap={isSmall ? 4 : 8} flexWrap="wrap" justify="center" overflow="hidden">
        {series.map((s, index) => {
          // Resolve decimal points for this series
          const colName = yAxisColumns?.[index]
          const dp = colName ? (columnFormats?.[colName]?.decimalPoints ?? undefined) : undefined
          const fmtVal = (v: number) => formatNumber(v, dp)

          // Get the last (most recent) value and the second-to-last (previous) value
          const currentValue = s.data[s.data.length - 1] || 0
          const previousValue = s.data.length > 1 ? s.data[s.data.length - 2] : null

          // Calculate percentage change
          let percentChange: number | null = null
          let isIncrease = false
          let isDecrease = false

          if (previousValue !== null && previousValue !== 0) {
            percentChange = ((currentValue - previousValue) / Math.abs(previousValue)) * 100
            isIncrease = percentChange > 0
            isDecrease = percentChange < 0
          }

          const color = colors[index % colors.length]
          const trendColor = isIncrease ? CHART_COLORS.teal : isDecrease ? CHART_COLORS.danger : color

          return (
            <VStack
              key={s.name}
              gap={isSmall ? 1 : 3}
              p={isSmall ? 3 : 6}
              minWidth={isSmall ? '0' : '220px'}
            >
              {/* Label */}
              <Text
                fontSize={isSmall ? '2xs' : 'xs'}
                fontWeight="700"
                color="fg.subtle"
                textTransform="uppercase"
                letterSpacing="0.05em"
                fontFamily="mono"
                truncate
              >
                {s.name}
              </Text>

              {/* Current Value */}
              <Text
                fontSize={isSmall ? '3xl' : '5xl'}
                fontWeight="800"
                color={color}
                fontFamily="mono"
                letterSpacing="-0.02em"
                lineHeight="1"
                truncate
              >
                {fmtVal(currentValue)}
              </Text>

              {/* Trend Indicator */}
              {percentChange !== null ? (
                <HStack gap={isSmall ? 1 : 2} align="center">
                  <Icon
                    as={isIncrease ? LuTrendingUp : isDecrease ? LuTrendingDown : LuMinus}
                    boxSize={isSmall ? 4 : 5}
                    color={trendColor}
                  />
                  <Text
                    fontSize={isSmall ? 'xs' : 'md'}
                    fontWeight="700"
                    color={trendColor}
                    fontFamily="mono"
                  >
                    {isIncrease ? '+' : ''}{percentChange.toFixed(1)}%
                  </Text>
                  <Text
                    fontSize={isSmall ? '2xs' : 'xs'}
                    color="fg.muted"
                    fontFamily="mono"
                  >
                    vs {previousValue !== null ? fmtVal(previousValue) : ''}
                  </Text>
                </HStack>
              ) : (
                <Text fontSize={isSmall ? '2xs' : 'xs'} color="fg.muted" fontFamily="mono">
                  No comparison data
                </Text>
              )}

              {/* Indicator line */}
              {!isSmall && (
                <Box
                  width="60px"
                  height="3px"
                  bg={trendColor}
                  borderRadius="full"
                />
              )}
            </VStack>
          )
        })}
      </HStack>
    </Box>
  )
}
