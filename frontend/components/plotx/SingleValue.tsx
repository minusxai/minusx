import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { CHART_COLORS } from '@/lib/chart/echarts-theme'
import { formatLargeNumber } from '@/lib/chart/chart-utils'

interface SingleValueProps {
  series: Array<{ name: string; data: number[] }>
}

export const SingleValue = ({ series }: SingleValueProps) => {
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

  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="center"
      height="100%"
      minHeight="400px"
    >
      <HStack gap={8} flexWrap="wrap" justify="center">
        {series.map((s, index) => {
          const value = s.data[0] || 0
          const color = colors[index % colors.length]

          return (
            <VStack
              key={s.name}
              gap={2}
              p={6}
              bg="bg.surface"
              borderRadius="md"
              border="2px solid"
              borderColor="border.default"
              minWidth="200px"
              _hover={{
                borderColor: color,
                shadow: `0 0 20px ${color}40`,
              }}
              transition="all 0.3s"
            >
              {/* Label */}
              <Text
                fontSize="xs"
                fontWeight="700"
                color="fg.subtle"
                textTransform="uppercase"
                letterSpacing="0.05em"
                fontFamily="mono"
              >
                {s.name}
              </Text>

              {/* Value */}
              <Text
                fontSize="5xl"
                fontWeight="800"
                color={color}
                fontFamily="mono"
                letterSpacing="-0.02em"
                lineHeight="1"
              >
{formatLargeNumber(value)}
              </Text>

              {/* Indicator line */}
              <Box
                width="60px"
                height="3px"
                bg={color}
                borderRadius="full"
                boxShadow={`0 0 8px ${color}80`}
              />
            </VStack>
          )
        })}
      </HStack>
    </Box>
  )
}
