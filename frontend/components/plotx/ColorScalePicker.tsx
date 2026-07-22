'use client'

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
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">Scale:</span>
      {COLOR_SCALES.map(({ key, colors }) => (
        <div
          key={key}
          className={`h-4 w-[56px] cursor-pointer rounded-sm border-2 transition-all duration-150 ${
            activeKey === key ? 'border-[#16a085]' : 'border-transparent hover:border-[#16a085]/50'
          }`}
          onClick={() => onChange(key)}
          style={{
            background: `linear-gradient(to right, ${colors.join(', ')})`,
          }}
        />
      ))}
    </div>
  )
}
