import { Box, VStack, Text } from '@chakra-ui/react'
import { formatLargeNumber } from '@/lib/chart/chart-utils'
import { useRef, useState, useEffect } from 'react'

interface SingleValueProps {
  values: Array<{ name: string; value: string | number | null }>
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

export const SingleValue = ({ values }: SingleValueProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const mode = useSizeMode(containerRef)

  if (!values || values.length === 0) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        No data to display
      </Box>
    )
  }

  const isSmall = mode === 'sm'

  const formatValue = (val: string | number | null): string => {
    if (val == null) return '—'
    if (typeof val === 'number') return formatLargeNumber(val)
    return String(val)
  }

  return (
    <Box
      ref={containerRef}
      display="flex"
      alignItems="center"
      justifyContent="center"
      height="100%"
      overflow="hidden"
    >
      <VStack gap={isSmall ? 1 : 2}>
        {values.map((item) => (
          <VStack key={item.name} gap={isSmall ? 1 : 2}>
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
              {item.name}
            </Text>

            {/* Value */}
            <Text
              fontSize={isSmall ? '4xl' : '6xl'}
              fontWeight="800"
              color="fg.default"
              fontFamily="mono"
              letterSpacing="-0.02em"
              lineHeight="1"
              truncate
            >
              {formatValue(item.value)}
            </Text>
          </VStack>
        ))}
      </VStack>
    </Box>
  )
}
