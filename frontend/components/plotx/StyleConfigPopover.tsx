'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, HStack, Text, VStack } from '@chakra-ui/react'
import { LuPalette } from 'react-icons/lu'
import { CHART_COLORS, COLOR_PALETTE } from '@/lib/chart/echarts-theme'
import type { VisualizationStyleConfig } from '@/lib/types'

interface StyleConfigPopoverProps {
  chartType: 'line' | 'bar' | 'area' | 'scatter' | 'funnel' | 'pie' | 'pivot' | 'trend' | 'waterfall' | 'combo'
  styleConfig?: VisualizationStyleConfig
  numSeries: number
  onChange: (config: VisualizationStyleConfig) => void
}

const HEX_TO_KEY = Object.fromEntries(Object.entries(CHART_COLORS).map(([k, v]) => [v, k]))
const OPACITY_OPTIONS = [0.25, 0.4, 0.6, 0.8, 1]
const MARKER_SIZE_OPTIONS = [
  { label: 'xs', value: 4 },
  { label: 'sm', value: 8 },
  { label: 'md', value: 16 },
  { label: 'lg', value: 20 },
  { label: 'xl', value: 30 },
] as const

const Circle = ({ color, size, selected, onClick }: { color: string; size: string; selected: boolean; onClick: () => void }) => (
  <Box
    w={size}
    h={size}
    borderRadius="full"
    bg={color}
    cursor="pointer"
    border="2px solid"
    borderColor={selected ? 'fg.default' : 'transparent'}
    opacity={selected ? 1 : 0.75}
    _hover={{ opacity: 1 }}
    transition="all 0.15s"
    flexShrink={0}
    onClick={onClick}
  />
)

const ChoicePill = ({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) => (
  <Box
    px={2}
    py={0.5}
    borderRadius="sm"
    cursor="pointer"
    fontSize="xs"
    fontFamily="mono"
    fontWeight={selected ? '700' : '500'}
    bg={selected ? 'accent.teal' : 'bg.surface'}
    color={selected ? 'white' : 'fg.default'}
    border="1px solid"
    borderColor={selected ? 'accent.teal' : 'border.muted'}
    _hover={{ bg: selected ? 'accent.teal' : 'bg.muted' }}
    onClick={onClick}
    transition="all 0.15s"
  >
    {children}
  </Box>
)

const hasStyleConfig = (config?: VisualizationStyleConfig) =>
  !!config && (
    (config.colors && Object.keys(config.colors).length > 0)
    || config.opacity != null
    || config.markerSize != null
  )

export const StyleConfigPopover = ({ chartType, styleConfig, numSeries, onChange }: StyleConfigPopoverProps) => {
  const [showPopover, setShowPopover] = useState(false)
  const [activeSeriesIndex, setActiveSeriesIndex] = useState<number | null>(null)
  const buttonRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const supportsMarkerSize = chartType === 'scatter' || chartType === 'line' || chartType === 'combo'
  const seriesCount = useMemo(() => Math.min(Math.max(numSeries, 1), COLOR_PALETTE.length), [numSeries])

  useEffect(() => {
    if (!showPopover) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        setShowPopover(false)
        setActiveSeriesIndex(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPopover])

  const emitConfig = (next: VisualizationStyleConfig) => {
    const normalized: VisualizationStyleConfig = {}
    if (next.colors && Object.keys(next.colors).length > 0) normalized.colors = next.colors
    if (next.opacity != null && next.opacity !== 1) normalized.opacity = next.opacity
    if (next.markerSize != null) normalized.markerSize = next.markerSize
    onChange(normalized)
  }

  const getSeriesColor = (index: number) => {
    const key = styleConfig?.colors?.[String(index)]
    return (key && CHART_COLORS[key as keyof typeof CHART_COLORS]) || COLOR_PALETTE[index % COLOR_PALETTE.length]
  }

  const handleColorChange = (index: number, hex?: string) => {
    const nextColors = { ...(styleConfig?.colors ?? {}) }
    if (!hex) delete nextColors[String(index)]
    else nextColors[String(index)] = HEX_TO_KEY[hex]
    emitConfig({ ...(styleConfig ?? {}), colors: nextColors })
  }

  return (
    <Box position="relative" ref={buttonRef}>
      <HStack
        as="button"
        gap={1}
        px={2}
        py={1}
        borderRadius="md"
        border="1px solid"
        borderColor={hasStyleConfig(styleConfig) ? 'accent.teal' : 'border.muted'}
        bg={hasStyleConfig(styleConfig) ? 'accent.teal/10' : 'bg.surface'}
        color={hasStyleConfig(styleConfig) ? 'accent.teal' : 'fg.subtle'}
        _hover={{ borderColor: 'accent.teal', color: 'accent.teal' }}
        transition="all 0.15s"
        onClick={() => setShowPopover(prev => !prev)}
      >
        <LuPalette size={12} />
        <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em">
          Style
        </Text>
      </HStack>

      {showPopover && (
        <VStack
          ref={popoverRef}
          position="absolute"
          top="100%"
          right={0}
          mt={1}
          align="stretch"
          p={3}
          width="280px"
          maxHeight="320px"
          overflowY="auto"
          gap={3}
          bg="bg.panel"
          border="1px solid"
          borderColor="border.muted"
          borderRadius="md"
          boxShadow="md"
          zIndex={20}
        >
          <Box>
            <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
              Colors
            </Text>
            <HStack gap={1.5} mb={2} flexWrap="wrap">
              {Array.from({ length: seriesCount }, (_, i) => (
                <Circle
                  key={i}
                  color={getSeriesColor(i)}
                  size="14px"
                  selected={activeSeriesIndex === i}
                  onClick={() => setActiveSeriesIndex(activeSeriesIndex === i ? null : i)}
                />
              ))}
            </HStack>
            {activeSeriesIndex !== null && (
              <VStack align="stretch" gap={1.5}>
                <HStack justify="space-between">
                  <Text fontSize="xs" fontFamily="mono" color="fg.subtle">{`Series ${activeSeriesIndex + 1}`}</Text>
                  <ChoicePill selected={!styleConfig?.colors?.[String(activeSeriesIndex)]} onClick={() => handleColorChange(activeSeriesIndex, undefined)}>
                    auto
                  </ChoicePill>
                </HStack>
                <HStack gap={1.5} flexWrap="wrap">
                  {COLOR_PALETTE.map(hex => (
                    <Circle
                      key={`${activeSeriesIndex}-${hex}`}
                      color={hex}
                      size="20px"
                      selected={getSeriesColor(activeSeriesIndex) === hex}
                      onClick={() => handleColorChange(activeSeriesIndex, hex)}
                    />
                  ))}
                </HStack>
              </VStack>
            )}
          </Box>

          <Box>
            <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
              Opacity
            </Text>
            <HStack gap={1} flexWrap="wrap">
              {OPACITY_OPTIONS.map(value => (
                <ChoicePill key={value} selected={(styleConfig?.opacity ?? 1) === value} onClick={() => emitConfig({ ...(styleConfig ?? {}), opacity: value })}>
                  {Math.round(value * 100)}%
                </ChoicePill>
              ))}
            </HStack>
          </Box>

          {supportsMarkerSize && (
            <Box>
              <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
                Marker Size
              </Text>
              <HStack gap={1} flexWrap="wrap">
                {MARKER_SIZE_OPTIONS.map(({ label, value }) => (
                  <ChoicePill key={label} selected={(styleConfig?.markerSize ?? (chartType === 'scatter' ? 8 : chartType === 'combo' ? 6 : 5)) === value} onClick={() => emitConfig({ ...(styleConfig ?? {}), markerSize: value })}>
                    {label}
                  </ChoicePill>
                ))}
              </HStack>
            </Box>
          )}
        </VStack>
      )}
    </Box>
  )
}
