'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Checkbox } from '@/components/kit/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/kit/select'
import {
  LuMap, LuMapPin, LuRoute, LuFlame,
  LuLayoutGrid, LuSettings2, LuChevronDown, LuChevronRight,
  LuCrosshair, LuX,
} from 'react-icons/lu'
import { AxisBuilder, type AxisZone } from './AxisBuilder'
import { resolveColumnType } from './AxisComponents'
import { ColorScalePicker } from './ColorScalePicker'
import { ColorPicker } from './ColorPicker'
import { MAP_OPTIONS } from '@/lib/chart/geo-data'
import type { GeoConfig, GeoSubType, ChoroplethConfig, PointsConfig, HeatmapConfig } from '@/lib/types'

const SUB_TYPES: Array<{ value: GeoSubType; icon: React.ElementType; label: string }> = [
  { value: 'choropleth', icon: LuMap, label: 'Choropleth' },
  { value: 'points', icon: LuMapPin, label: 'Points' },
  { value: 'lines', icon: LuRoute, label: 'Lines' },
  { value: 'heatmap', icon: LuFlame, label: 'Heatmap' },
]

// Tiny section label (Chakra 2xs/700/0.05em equivalent)
const SECTION_LABEL = 'text-[10px] font-bold uppercase tracking-wider text-muted-foreground'

interface GeoAxisBuilderProps {
  columns: string[]
  types: string[]
  geoConfig?: GeoConfig
  onGeoConfigChange: (config: GeoConfig) => void
  tooltipCols?: string[]
  onTooltipColsChange?: (cols: string[]) => void
  colorOverrides?: Record<string, string>
  onColorOverridesChange?: (overrides: Record<string, string>) => void
  getMapView?: () => { center: [number, number]; zoom: number } | null
}

const DEFAULT_CONFIG: ChoroplethConfig = { subType: 'choropleth', showTiles: false, mapName: 'us-states' }

/** Number input that uses local string state so the field is freely editable. Commits on blur. */
function NumInput({ value, placeholder, ariaLabel, onCommit }: {
  value: number | undefined | null
  placeholder: string
  ariaLabel: string
  onCommit: (v: number | undefined) => void
}) {
  const [local, setLocal] = useState(value != null ? String(value) : '')
  /* eslint-disable react-hooks/refs -- standard "previous value" pattern for render-time sync */
  const prevValue = useRef(value)
  if (value !== prevValue.current) {
    prevValue.current = value
    setLocal(value != null ? String(value) : '')
  }
  /* eslint-enable react-hooks/refs */

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const trimmed = local.trim()
        if (trimmed === '') {
          onCommit(undefined)
        } else {
          const n = Number(trimmed)
          onCommit(isNaN(n) ? undefined : n)
        }
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      onClick={(e) => e.stopPropagation()}
      className="w-[60px] rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-xs text-foreground outline-none"
    />
  )
}

function PointsSizeInputs({ config, onUpdate }: { config: PointsConfig; onUpdate: (partial: Record<string, unknown>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-xs text-muted-foreground">Min Radius</span>
        <NumInput
          value={config.minRadius}
          placeholder="5"
          ariaLabel="Min radius"
          onCommit={(v) => onUpdate({ minRadius: v })}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-xs text-muted-foreground">Scale</span>
        <NumInput
          value={config.radiusScale}
          placeholder="1"
          ariaLabel="Radius scale"
          onCommit={(v) => onUpdate({ radiusScale: v })}
        />
      </div>
    </div>
  )
}

// Module-scoped defaults so empty defaults don't re-trigger memos/effects
// downstream (tooltipCols is in a useMemo dep at line 235).
const EMPTY_TOOLTIP_COLS: string[] = []
const EMPTY_COLOR_OVERRIDES: Record<string, string> = {}

export function GeoAxisBuilder({
  columns,
  types,
  geoConfig,
  onGeoConfigChange,
  tooltipCols = EMPTY_TOOLTIP_COLS,
  onTooltipColsChange,
  colorOverrides = EMPTY_COLOR_OVERRIDES,
  onColorOverridesChange,
  getMapView,
}: GeoAxisBuilderProps) {
  const config = geoConfig ?? DEFAULT_CONFIG

  const [activeTab, setActiveTab] = useState<'fields' | 'settings'>('fields')
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({
    geo: false,
  })

  // Auto-fire initial config
  useEffect(() => {
    if (!geoConfig) {
      onGeoConfigChange(DEFAULT_CONFIG)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubTypeChange = useCallback(
    (subType: GeoSubType) => {
      const shared = { showTiles: config.showTiles, mapName: config.mapName }
      switch (subType) {
        case 'choropleth':
          onGeoConfigChange({ subType, ...shared, mapName: shared.mapName ?? 'us-states' })
          break
        case 'points':
          onGeoConfigChange({ subType, ...shared })
          break
        case 'lines':
          onGeoConfigChange({ subType, ...shared })
          break
        case 'heatmap':
          onGeoConfigChange({ subType, ...shared })
          break
      }
    },
    [config.showTiles, config.mapName, onGeoConfigChange],
  )

  const togglePanel = (key: string) => {
    setCollapsedPanels(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderSettingsCard = (title: string, panelKey: string, children: React.ReactNode) => {
    const collapsed = collapsedPanels[panelKey]
    return (
      <div
        className={`flex min-w-0 flex-col items-stretch rounded-md border-2 border-dashed border-border bg-card p-3 ${collapsed ? 'gap-0' : 'gap-2.5'}`}
      >
        <div className="flex items-center justify-between">
          <span className={SECTION_LABEL}>
            {title}
          </span>
          <button
            type="button"
            onClick={() => togglePanel(panelKey)}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            className="inline-flex cursor-pointer items-center border-none bg-transparent p-0 text-muted-foreground"
          >
            {collapsed ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
          </button>
        </div>
        {!collapsed && children}
      </div>
    )
  }

  /** Build a drop zone for a single column field on the current config. */
  const makeZone = useCallback(
    (label: string, fieldKey: string, emptyText: string): AxisZone => {
      const currentValue = (config as unknown as Record<string, unknown>)[fieldKey] as string | undefined
      return {
        label,
        emptyText,
        items: currentValue ? [{ column: currentValue }] : [],
        onDrop: (col: string) => onGeoConfigChange({ ...config, [fieldKey]: col } as GeoConfig),
        onRemove: () => onGeoConfigChange({ ...config, [fieldKey]: null } as GeoConfig),
      }
    },
    [config, onGeoConfigChange],
  )

  const tooltipZone: AxisZone = useMemo(() => ({
    label: 'Tooltip',
    items: tooltipCols.filter(c => columns.includes(c)).map(col => ({ column: col })),
    emptyText: 'Drop columns for tooltip',
    onDrop: (col: string) => {
      if (!tooltipCols.includes(col)) {
        onTooltipColsChange?.([...tooltipCols, col])
      }
    },
    onRemove: (col: string) => {
      onTooltipColsChange?.(tooltipCols.filter(c => c !== col))
    },
  }), [tooltipCols, columns, onTooltipColsChange])

  const zones: AxisZone[] = useMemo(() => {
    let subTypeZones: AxisZone[]
    switch (config.subType) {
      case 'choropleth':
        subTypeZones = [
          makeZone('Region', 'regionCol', 'Drop region column'),
          makeZone('Value', 'valueCol', 'Drop value column'),
        ]
        break
      case 'points':
        subTypeZones = [
          makeZone('Latitude', 'latCol', 'Drop lat column'),
          makeZone('Longitude', 'lngCol', 'Drop lng column'),
          makeZone('Size (optional)', 'valueCol', 'Drop value for bubble sizing'),
          makeZone('Color (optional)', 'colorCol', 'Drop column to color points'),
        ]
        break
      case 'lines':
        subTypeZones = [
          makeZone('Origin Lat', 'latCol', 'Drop origin lat'),
          makeZone('Origin Lng', 'lngCol', 'Drop origin lng'),
          makeZone('Dest Lat', 'latCol2', 'Drop dest lat'),
          makeZone('Dest Lng', 'lngCol2', 'Drop dest lng'),
        ]
        break
      case 'heatmap':
        subTypeZones = [
          makeZone('Latitude', 'latCol', 'Drop lat column'),
          makeZone('Longitude', 'lngCol', 'Drop lng column'),
          makeZone('Intensity (optional)', 'valueCol', 'Drop value column'),
        ]
        break
      default:
        subTypeZones = []
    }
    return [...subTypeZones, tooltipZone]
  }, [config.subType, makeZone, tooltipZone])

  /** Helper to update current config with narrowed type fields via spread. */
  const update = useCallback(
    (partial: Record<string, unknown>) => {
      onGeoConfigChange({ ...config, ...partial } as GeoConfig)
    },
    [config, onGeoConfigChange],
  )

  return (
    <div className="flex flex-col items-stretch gap-3">
      {/* Map sub-type selector — grid matching viz type selector */}
      <div>
        <div className={`${SECTION_LABEL} mb-1.5 font-mono`}>
          Geo Subtypes
        </div>
      <div
        className="grid w-full gap-1 rounded-md bg-muted/50 p-2"
        style={{ gridTemplateColumns: `repeat(${SUB_TYPES.length}, 1fr)` }}
      >
        {SUB_TYPES.map(({ value, icon: Icon, label }) => {
          const isActive = config.subType === value
          return (
            <button
              key={value}
              type="button"
              aria-label={`Geo sub-type ${label}`}
              className={`flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md py-1.5 transition-all duration-[120ms] ease-in-out ${
                isActive
                  ? 'bg-[#16a085]/15 text-[#16a085] hover:bg-[#16a085]/20'
                  : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              onClick={() => handleSubTypeChange(value)}
            >
              <Icon size={16} />
              <span className={`font-mono text-[10px] leading-none ${isActive ? 'font-bold' : 'font-medium'}`}>
                {label}
              </span>
            </button>
          )
        })}
      </div>
      </div>

      {/* Tab bar — segmented control */}
      <div className="flex max-w-[240px] items-center gap-0 rounded-md bg-muted p-0.5">
        {([{ key: 'fields', icon: LuLayoutGrid, label: 'Fields' }, { key: 'settings', icon: LuSettings2, label: 'Settings' }] as const).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            type="button"
            aria-label={`Geo ${label} tab`}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm py-1.5 transition-all duration-150 ${
              activeTab === key
                ? 'bg-[#16a085]/90 text-white'
                : 'bg-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(key)}
          >
            <Icon className="text-sm" />
            <span className="font-mono text-xs font-semibold">
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* Fields tab — column drop zones */}
      {activeTab === 'fields' && (
        <AxisBuilder columns={columns} types={types} zones={zones} borderless />
      )}

      {/* Settings tab — base map, tiles, color scale */}
      {activeTab === 'settings' && (
        <div className="relative z-[500] flex flex-col gap-3">
          {renderSettingsCard('Geo Settings', 'geo',
            <div className="flex flex-col items-stretch gap-3">
              <div className="flex flex-wrap items-center gap-4">
                {/* Base Map checkbox + dropdown */}
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={!!config.mapName}
                      onCheckedChange={(checked) => {
                        update({ mapName: checked === true ? (config.mapName || 'us-states') : null })
                      }}
                    />
                    <span className="text-xs text-muted-foreground">GeoJSON Map</span>
                  </label>
                  {!!config.mapName && (
                    <Select
                      value={config.mapName}
                      onValueChange={(v) => update({ mapName: v || null })}
                    >
                      <SelectTrigger size="sm" aria-label="Base map selector" className="w-[180px] text-xs">
                        <SelectValue placeholder="Select map..." />
                      </SelectTrigger>
                      <SelectContent>
                        {MAP_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Tiles toggle */}
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={config.showTiles ?? false}
                    onCheckedChange={(checked) => update({ showTiles: checked === true })}
                  />
                  <span className="text-xs text-muted-foreground">OpenStreetMap Tiles</span>
                </label>
              </div>

              {/* Pin / Unpin view */}
              <div className="flex items-center gap-2">
                {config.pinnedCenter ? (
                  <>
                    <span className="font-mono text-xs text-muted-foreground">
                      Pinned: {config.pinnedCenter[0].toFixed(2)}, {config.pinnedCenter[1].toFixed(2)} z{config.pinnedZoom ?? '?'}
                    </span>
                    <button
                      type="button"
                      aria-label="Unpin map view"
                      className="flex cursor-pointer items-center gap-1 rounded-md bg-[#c0392b]/10 px-2 py-1 text-xs font-semibold text-[#c0392b] hover:bg-[#c0392b]/20"
                      onClick={() => update({ pinnedCenter: undefined, pinnedZoom: undefined })}
                    >
                      <LuX size={12} />
                      <span className="text-xs">Unpin</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label="Pin current map view"
                    className="flex cursor-pointer items-center gap-1 rounded-md bg-[#16a085]/10 px-2 py-1 text-xs font-semibold text-[#16a085] hover:bg-[#16a085]/20"
                    onClick={() => {
                      const view = getMapView?.()
                      if (view) {
                        update({ pinnedCenter: view.center, pinnedZoom: view.zoom })
                      }
                    }}
                  >
                    <LuCrosshair size={12} />
                    <span className="text-xs">Pin Current View</span>
                  </button>
                )}
              </div>

              {/* Color scale (choropleth, heatmap, or points with numeric colorCol) */}
              {(config.subType === 'choropleth' || config.subType === 'heatmap' || (config.subType === 'points' && !!(config as PointsConfig).colorCol && resolveColumnType((config as PointsConfig).colorCol!, columns, types) === 'number')) && (
                <ColorScalePicker
                  value={(config as ChoroplethConfig | HeatmapConfig | PointsConfig).colorScale}
                  defaultScale="green"
                  onChange={(scale) => update({ colorScale: scale })}
                />
              )}

              {/* Points sizing */}
              {config.subType === 'points' && (
                <PointsSizeInputs config={config as PointsConfig} onUpdate={update} />
              )}

              {/* Marker color (points without colorCol, & lines) */}
              {(((config.subType === 'points' && !(config as PointsConfig).colorCol) || config.subType === 'lines') && onColorOverridesChange) && (
                <div className="self-start">
                  <ColorPicker
                    colorOverrides={colorOverrides}
                    numSeries={1}
                    onChange={onColorOverridesChange}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
