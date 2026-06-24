import { Box, VStack, Text } from '@chakra-ui/react'
import { useRef, useState, useEffect } from 'react'
import { resolveSingleValueDisplay, type SingleValueItem } from '@/lib/chart/single-value'
import type { SingleValueConfig } from '@/lib/validation/atlas-schemas'

interface SingleValueProps {
  values: SingleValueItem[]
  config?: SingleValueConfig | null
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

const ALIGN_ITEMS: Record<'left' | 'center' | 'right', 'flex-start' | 'center' | 'flex-end'> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
}

export const SingleValue = ({ values, config }: SingleValueProps) => {
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
  const align = config?.align ?? 'center'
  const alignItems = ALIGN_ITEMS[align]

  return (
    <Box
      ref={containerRef}
      display="flex"
      alignItems="center"
      justifyContent={alignItems === 'center' ? 'center' : 'flex-start'}
      height="100%"
      overflow="hidden"
      px={align === 'center' ? 0 : 6}
    >
      <VStack gap={isSmall ? 1 : 2} alignItems={alignItems}>
        {values.map((item) => {
          const d = resolveSingleValueDisplay(item, config)
          return (
            <VStack key={item.name} gap={isSmall ? 1 : 2} alignItems={alignItems}>
              {/* Label (hidden when the agent overrides it to an empty string) */}
              {d.label !== '' && (
                <Text
                  fontSize={isSmall ? 'xs' : 'sm'}
                  fontWeight="700"
                  color="fg.muted"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  fontFamily="mono"
                  textAlign={align}
                  style={d.labelStyle}
                  truncate
                >
                  {d.label}
                </Text>
              )}

              {/* Value — always the live number; config only styles it */}
              <Text
                aria-label={`single value ${item.name}`}
                fontSize={isSmall ? '4xl' : '6xl'}
                fontWeight="800"
                color="fg.default"
                fontFamily="mono"
                letterSpacing="-0.02em"
                lineHeight="1"
                textAlign={align}
                style={d.valueStyle}
                truncate
              >
                {d.text}
              </Text>
            </VStack>
          )
        })}
      </VStack>
    </Box>
  )
}
