'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { CHART_COLORS, COLOR_PALETTE, resolveSeriesColor } from '@/lib/chart/chart-theme'
import { useConfigs } from '@/lib/hooks/useConfigs'

interface ColorPickerProps {
  colorOverrides: Record<string, string>
  numSeries: number
  onChange: (overrides: Record<string, string>) => void
}

const HEX_TO_KEY = Object.fromEntries(Object.entries(CHART_COLORS).map(([k, v]) => [v, k]))

const Circle = ({ color, size, selected, onClick }: { color: string; size: string; selected: boolean; onClick: () => void }) => (
  <div
    className={`shrink-0 cursor-pointer rounded-full border-2 transition-all duration-150 hover:opacity-100 ${
      selected ? 'border-foreground opacity-100' : 'border-transparent opacity-60'
    }`}
    style={{ width: size, height: size, background: color }}
    onClick={onClick}
  />
)

export const ColorPicker = ({ colorOverrides, numSeries, onChange }: ColorPickerProps) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const { config } = useConfigs()
  const palette = useMemo(() => {
    const p = config.chartColorPalette
    return p && p.length > 0 ? p : COLOR_PALETTE
  }, [config.chartColorPalette])

  useEffect(() => {
    if (activeIndex === null) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setActiveIndex(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeIndex])

  const getColor = (i: number) => {
    const value = colorOverrides[String(i)] || colorOverrides[i as unknown as string]
    return resolveSeriesColor(value) || palette[i % palette.length]
  }

  const handlePick = (hex: string) => {
    if (activeIndex === null) return
    const key = HEX_TO_KEY[hex]
    // Always emit a full mapping for all series (deepMerge can't delete keys)
    const next: Record<string, string> = {}
    for (let i = 0; i < Math.max(numSeries, 1); i++) {
      const existing = colorOverrides[String(i)] || colorOverrides[i as unknown as string]
      const defaultKey = HEX_TO_KEY[palette[i % palette.length]]
      next[String(i)] = (i === activeIndex) ? key : (existing || defaultKey)
    }
    onChange(next)
    setActiveIndex(null)
  }

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center justify-center gap-1.5 px-1 py-0.5">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Colors</span>
        {Array.from({ length: Math.min(Math.max(numSeries, 1), palette.length) }, (_, i) => (
          <Circle key={i} color={getColor(i)} size="14px" selected={activeIndex === i}
            onClick={() => setActiveIndex(activeIndex === i ? null : i)} />
        ))}
      </div>

      {activeIndex !== null && (
        <div className="absolute right-0 top-full z-20 mt-1 rounded-md border border-border bg-popover p-2 shadow-md">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {palette.map((hex) => (
              <Circle key={hex} color={hex} size="24px" selected={getColor(activeIndex) === hex}
                onClick={() => handlePick(hex)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
