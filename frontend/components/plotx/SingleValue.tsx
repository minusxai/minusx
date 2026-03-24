import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { CHART_COLORS } from '@/lib/chart/echarts-theme'
import { formatLargeNumber } from '@/lib/chart/chart-utils'
import { useRef, useState, useEffect } from 'react'

interface SingleValueProps {
  series: Array<{ name: string; data: number[] }>
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

export const SingleValue = ({ series }: SingleValueProps) => {
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
          const value = s.data[0] || 0
          const color = series.length === 1 ? 'var(--chakra-colors-fg-default)' : colors[index % colors.length]

          return (
            <VStack
              key={s.name}
              gap={isSmall ? 1 : 2}
            //   p={isSmall ? 3 : 6}
            //   bg="bg.surface"
            //   borderRadius="md"
            //   border="2px solid"
            //   borderColor="border.default"
            //   minWidth={'200px'}
              _hover={{
                borderColor: color,
                shadow: `0 0 20px ${color}40`,
              }}
              transition="all 0.3s"
            >
              {/* Label */}
              <Text
                fontSize={isSmall ? 'xs' : 'sm'}
                fontWeight="700"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="0.05em"
                fontFamily="mono"
                truncate
              >
                {s.name}
              </Text>

              {/* Value */}
              <Text
                fontSize={isSmall ? '4xl' : '6xl'}
                fontWeight="800"
                color={color}
                fontFamily="mono"
                letterSpacing="-0.02em"
                lineHeight="1"
                truncate
              >
                {formatLargeNumber(value)}
              </Text>

              {/* Indicator line */}
              {!isSmall && (
                <Box
                  width="60px"
                  height="3px"
                  bg={color}
                  borderRadius="full"
                  boxShadow={`0 0 8px ${color}80`}
                />
              )}
            </VStack>
          )
        })}
      </HStack>
    </Box>
  )
}
