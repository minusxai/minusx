'use client'

import { Box, HStack, Text } from '@chakra-ui/react'
import { COLOR_SCALES, type ColorScaleKey } from '@/lib/chart/geo-color-scale'

interface ColorScalePickerProps {
  value: ColorScaleKey | string | null | undefined
  onChange: (scale: ColorScaleKey) => void
  defaultScale?: ColorScaleKey
}

/**
 * Shared color scale selector — gradient swatches the user clicks to pick a scale.
 * Used by both geo choropleth and pivot heatmap.
 */
export function ColorScalePicker({ value, onChange, defaultScale = 'green' }: ColorScalePickerProps) {
  const activeKey = value ?? defaultScale

  return (
    <HStack gap={1}>
      <Text fontSize="xs" color="fg.muted">Scale:</Text>
      {COLOR_SCALES.map(({ key, colors }) => (
        <Box
          key={key}
          w="56px"
          h="16px"
          borderRadius="sm"
          cursor="pointer"
          border="2px solid"
          borderColor={activeKey === key ? 'accent.teal' : 'transparent'}
          _hover={{ borderColor: 'accent.teal/50' }}
          transition="all 0.15s"
          onClick={() => onChange(key)}
          style={{
            background: `linear-gradient(to right, ${colors.join(', ')})`,
          }}
        />
      ))}
    </HStack>
  )
}
