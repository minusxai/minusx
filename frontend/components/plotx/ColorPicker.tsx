'use client'

import { useState, useRef, useEffect } from 'react'
import { Box, HStack, Text } from '@chakra-ui/react'
import { CHART_COLORS, COLOR_PALETTE } from '@/lib/chart/echarts-theme'

interface ColorPickerProps {
  colorOverrides: Record<string, string>
  numSeries: number
  onChange: (overrides: Record<string, string>) => void
}

const HEX_TO_KEY = Object.fromEntries(Object.entries(CHART_COLORS).map(([k, v]) => [v, k]))

const Circle = ({ color, size, selected, onClick }: { color: string; size: string; selected: boolean; onClick: () => void }) => (
  <Box
    w={size} h={size} borderRadius="full" bg={color} cursor="pointer"
    border="2px solid" borderColor={selected ? 'fg.default' : 'transparent'}
    opacity={selected ? 1 : 0.6} _hover={{ opacity: 1 }}
    transition="all 0.15s" flexShrink={0} onClick={onClick}
  />
)

export const ColorPicker = ({ colorOverrides, numSeries, onChange }: ColorPickerProps) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeIndex === null) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setActiveIndex(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeIndex])

  const getColor = (i: number) => {
    const key = colorOverrides[String(i)] || colorOverrides[i as unknown as string]
    return (key && CHART_COLORS[key as keyof typeof CHART_COLORS]) || COLOR_PALETTE[i % COLOR_PALETTE.length]
  }

  const handlePick = (hex: string) => {
    if (activeIndex === null) return
    const key = HEX_TO_KEY[hex]
    // Always emit a full mapping for all series (deepMerge can't delete keys)
    const next: Record<string, string> = {}
    for (let i = 0; i < Math.max(numSeries, 1); i++) {
      const existing = colorOverrides[String(i)] || colorOverrides[i as unknown as string]
      const defaultKey = HEX_TO_KEY[COLOR_PALETTE[i % COLOR_PALETTE.length]]
      next[String(i)] = (i === activeIndex) ? key : (existing || defaultKey)
    }
    onChange(next)
    setActiveIndex(null)
  }

  return (
    <Box position="relative" ref={ref}>
      <HStack gap={1.5} px={1} py={0.5} alignItems="center" justify="center">
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" flexShrink={0}>Colors</Text>
        {Array.from({ length: Math.min(Math.max(numSeries, 1), COLOR_PALETTE.length) }, (_, i) => (
          <Circle key={i} color={getColor(i)} size="14px" selected={activeIndex === i}
            onClick={() => setActiveIndex(activeIndex === i ? null : i)} />
        ))}
      </HStack>

      {activeIndex !== null && (
        <Box position="absolute" top="100%" right={0} mt={1} bg="bg.panel"
          border="1px solid" borderColor="border.muted" borderRadius="md" boxShadow="md" zIndex={20} p={2}>
          <HStack gap={1.5} flexWrap="wrap" justify="center">
            {COLOR_PALETTE.map((hex) => (
              <Circle key={hex} color={hex} size="24px" selected={getColor(activeIndex) === hex}
                onClick={() => handlePick(hex)} />
            ))}
          </HStack>
        </Box>
      )}
    </Box>
  )
}
