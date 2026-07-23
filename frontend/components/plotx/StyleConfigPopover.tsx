'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LuPalette, LuPipette } from 'react-icons/lu'
import { CHART_COLORS, COLOR_PALETTE, resolveSeriesColor } from '@/lib/chart/chart-theme'
import { useConfigs } from '@/lib/hooks/useConfigs'
import type { VisualizationStyleConfig, VisualizationType } from '@/lib/types'

interface StyleConfigPopoverProps {
  chartType: Exclude<VisualizationType, 'table' | 'geo' | 'single_value'>
  styleConfig?: VisualizationStyleConfig
  numSeries: number
  onChange: (config: VisualizationStyleConfig) => void
  displayMode?: 'auto' | 'button' | 'inline'
}

const HEX_TO_KEY = Object.fromEntries(Object.entries(CHART_COLORS).map(([k, v]) => [v, k]))
const OPACITY_OPTIONS = [0.25, 0.5, 0.75, 1]
const MARKER_SIZE_OPTIONS = [
  { label: 'xs', value: 4 },
  { label: 'sm', value: 8 },
  { label: 'md', value: 16 },
  { label: 'lg', value: 20 },
  { label: 'xl', value: 30 },
] as const

// Tiny section label (Chakra 2xs/700/0.05em equivalent)
const SECTION_LABEL = 'text-[10px] font-bold uppercase tracking-wider text-muted-foreground'

const Circle = ({ color, size, selected, onClick, label }: { color: string; size: string; selected: boolean; onClick: () => void; label?: string }) => (
  <div
    aria-label={label}
    className={`shrink-0 cursor-pointer rounded-full border-2 transition-all duration-150 hover:opacity-100 ${
      selected ? 'border-foreground opacity-100' : 'border-transparent opacity-75'
    }`}
    style={{ width: size, height: size, background: color }}
    onClick={onClick}
  />
)

// Native color input. Uncontrolled (defaultValue) so the picker owns its value while open.
// onChange fires as the user picks; we debounce the commit by 200ms so a rapid drag coalesces
// into one chart update instead of a per-pixel flood.
export const SeriesColorInput = ({ value, onCommit, label }: { value: string; onCommit: (hex: string) => void; label: string }) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleChange = (hex: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onCommit(hex), 200)
  }

  return (
    <label
      aria-label={label}
      className="relative block h-5 w-5 shrink-0 cursor-pointer rounded-full border-2 border-border transition-all duration-150 hover:border-foreground"
      style={{ background: value }}
      title="Custom color"
    >
      <LuPipette size={11} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'white', fill: 'white', filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.85))' }} />
      <input
        type="color"
        aria-label={`${label} input`}
        defaultValue={value}
        onChange={(e) => handleChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', padding: 0, border: 'none' }}
      />
    </label>
  )
}

const ChoicePill = ({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) => (
  <div
    className={`cursor-pointer rounded-sm border px-2 py-0.5 font-mono text-xs transition-all duration-150 ${
      selected
        ? 'border-[#16a085] bg-[#16a085] font-bold text-white'
        : 'border-border bg-card font-medium text-foreground hover:bg-muted'
    }`}
    onClick={onClick}
  >
    {children}
  </div>
)

const hasStyleConfig = (config?: VisualizationStyleConfig) =>
  !!config && (
    (config.colors && Object.keys(config.colors).length > 0)
    || config.opacity != null
    || config.markerSize != null
    || config.stacked != null
    || config.showDataLabels != null
  )

export const StyleConfigPopover = ({ chartType, styleConfig, numSeries, onChange, displayMode = 'auto' }: StyleConfigPopoverProps) => {
  const [showPopover, setShowPopover] = useState(false)
  const [activeSeriesIndex, setActiveSeriesIndex] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const { config } = useConfigs()
  const palette = useMemo(() => {
    const p = config.chartColorPalette
    return p && p.length > 0 ? p : COLOR_PALETTE
  }, [config.chartColorPalette])

  const supportsMarkerSize = chartType === 'scatter' || chartType === 'line' || chartType === 'combo'
  const supportsStacking = chartType === 'bar' || chartType === 'row' || chartType === 'area' || chartType === 'combo'
  const seriesCount = useMemo(() => Math.min(Math.max(numSeries, 1), palette.length), [numSeries, palette.length])
  const selectedOpacity = styleConfig?.opacity == null ? 1 : styleConfig.opacity
  const isStacked = styleConfig?.stacked ?? true

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

  useEffect(() => {
    if (displayMode !== 'auto' || !containerRef.current) return

    const node = containerRef.current
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setContainerWidth(entry.contentRect.width)
      }
    })

    observer.observe(node)
    setContainerWidth(node.getBoundingClientRect().width)

    return () => observer.disconnect()
  }, [displayMode])

  const emitConfig = (next: VisualizationStyleConfig) => {
    const normalized: VisualizationStyleConfig = {}
    if (next.colors && Object.keys(next.colors).length > 0) normalized.colors = next.colors
    if (next.opacity === 1) normalized.opacity = null
    else if (next.opacity != null) normalized.opacity = next.opacity
    if (next.markerSize != null) normalized.markerSize = next.markerSize
    if (next.stacked != null) normalized.stacked = next.stacked
    if (next.showDataLabels != null) normalized.showDataLabels = next.showDataLabels
    if (next.dataLabelColor != null) normalized.dataLabelColor = next.dataLabelColor
    onChange(normalized)
  }

  const getSeriesColor = (index: number) => {
    return resolveSeriesColor(styleConfig?.colors?.[String(index)]) || palette[index % palette.length]
  }

  // Stores a color for a series. A palette swatch is stored as its named key (so it
  // follows org-palette changes); a custom hex from the color input is stored raw.
  const handleColorChange = (index: number, value?: string) => {
    const nextColors = { ...(styleConfig?.colors ?? {}) }
    if (!value) delete nextColors[String(index)]
    else nextColors[String(index)] = HEX_TO_KEY[value] ?? value
    emitConfig({ ...(styleConfig ?? {}), colors: nextColors })
  }

  const renderContent = (inline: boolean) => (
    <div
      className={`flex flex-col items-stretch ${
        inline
          ? 'w-full gap-2 overflow-visible border-none bg-transparent p-0'
          : 'max-h-[320px] w-[280px] gap-3 overflow-y-auto rounded-md border border-border bg-popover p-3 shadow-md'
      }`}
    >
      <div>
        <div className={`${SECTION_LABEL} mb-1`}>
          Colors
        </div>
        <div className={`flex flex-wrap items-center gap-1.5 ${activeSeriesIndex !== null ? 'mb-1.5' : 'mb-0'}`}>
          {Array.from({ length: seriesCount }, (_, i) => (
            <Circle
              key={i}
              label={`Series ${i + 1} color`}
              color={getSeriesColor(i)}
              size="14px"
              selected={activeSeriesIndex === i}
              onClick={() => setActiveSeriesIndex(activeSeriesIndex === i ? null : i)}
            />
          ))}
        </div>
        {activeSeriesIndex !== null && (
          <div className="flex flex-col items-stretch gap-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">{`Series ${activeSeriesIndex + 1}`}</span>
              <div className="flex items-center gap-1.5">
                <SeriesColorInput
                  key={`series-${activeSeriesIndex}`}
                  label={`Series ${activeSeriesIndex + 1} custom color`}
                  value={getSeriesColor(activeSeriesIndex)}
                  onCommit={(hex) => handleColorChange(activeSeriesIndex, hex)}
                />
                <ChoicePill selected={!styleConfig?.colors?.[String(activeSeriesIndex)]} onClick={() => handleColorChange(activeSeriesIndex, undefined)}>
                  auto
                </ChoicePill>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {palette.map(hex => (
                <Circle
                  key={`${activeSeriesIndex}-${hex}`}
                  color={hex}
                  size={inline ? '16px' : '20px'}
                  selected={getSeriesColor(activeSeriesIndex) === hex}
                  onClick={() => handleColorChange(activeSeriesIndex, hex)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <div className={`${SECTION_LABEL} mb-1`}>
          Opacity
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {OPACITY_OPTIONS.map(value => (
            <ChoicePill key={value} selected={selectedOpacity === value} onClick={() => emitConfig({ ...(styleConfig ?? {}), opacity: value })}>
              {Math.round(value * 100)}%
            </ChoicePill>
          ))}
        </div>
      </div>

      {supportsMarkerSize && (
        <div>
          <div className={`${SECTION_LABEL} mb-1`}>
            Marker
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {MARKER_SIZE_OPTIONS.map(({ label, value }) => (
              <ChoicePill key={label} selected={(styleConfig?.markerSize ?? (chartType === 'scatter' ? 8 : chartType === 'combo' ? 6 : 5)) === value} onClick={() => emitConfig({ ...(styleConfig ?? {}), markerSize: value })}>
                {label}
              </ChoicePill>
            ))}
          </div>
        </div>
      )}

      {supportsStacking && (
        <div>
          <div className={`${SECTION_LABEL} mb-1`}>
            Stacking
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <ChoicePill selected={isStacked} onClick={() => emitConfig({ ...(styleConfig ?? {}), stacked: true })}>
              Stacked
            </ChoicePill>
            <ChoicePill selected={!isStacked} onClick={() => emitConfig({ ...(styleConfig ?? {}), stacked: false })}>
              Separate
            </ChoicePill>
          </div>
        </div>
      )}

      <div>
        <div className={`${SECTION_LABEL} mb-1`}>
          Data Labels
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <ChoicePill selected={!styleConfig?.showDataLabels} onClick={() => emitConfig({ ...(styleConfig ?? {}), showDataLabels: false })}>
            Off
          </ChoicePill>
          <ChoicePill selected={!!styleConfig?.showDataLabels} onClick={() => emitConfig({ ...(styleConfig ?? {}), showDataLabels: true })}>
            On
          </ChoicePill>
          {styleConfig?.showDataLabels && (
            <SeriesColorInput
              label="Data label color"
              value={styleConfig?.dataLabelColor || '#000000'}
              onCommit={(hex) => emitConfig({ ...(styleConfig ?? {}), dataLabelColor: hex })}
            />
          )}
        </div>
      </div>
    </div>
  )

  const showInline = displayMode === 'inline' || (displayMode === 'auto' && containerWidth >= 220)

  return (
    <div className="relative flex w-full items-center justify-center" ref={containerRef}>
      {showInline ? (
        renderContent(true)
      ) : (
        <>
          <button
            ref={buttonRef}
            type="button"
            className={`flex items-center gap-1 rounded-md border px-2 py-1 transition-all duration-150 hover:border-[#16a085] hover:text-[#16a085] ${
              hasStyleConfig(styleConfig)
                ? 'border-[#16a085] bg-[#16a085]/10 text-[#16a085]'
                : 'border-border bg-card text-muted-foreground'
            }`}
            onClick={() => setShowPopover(prev => !prev)}
          >
            <LuPalette size={12} />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Options
            </span>
          </button>

          {showPopover && (
            <div
              ref={popoverRef}
              className="absolute right-0 top-full z-20 mt-1"
            >
              {renderContent(false)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
