'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { LuChevronDown, LuChevronRight, LuLayoutGrid, LuSettings2 } from 'react-icons/lu'
import { Switch } from '@/components/kit/switch'
import { ColumnChip, DropZone, ZoneChip, resolveColumnType, useIsTouchDevice } from './AxisComponents'
import type { ColumnFormatConfig, AxisConfig } from '@/lib/types'

export interface AxisZone {
  label: string
  items: Array<{ column: string; extra?: React.ReactNode }>
  emptyText?: string
  onDrop: (column: string) => void
  onRemove: (column: string) => void
}

// Tiny section label used throughout (Chakra 2xs/700/0.05em equivalent)
const SECTION_LABEL = 'text-[10px] font-bold uppercase tracking-wider text-muted-foreground'
const INPUT_CLASSES = 'w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground outline-none'

/**
 * Declares which settings panels are visible for a given chart type.
 * AxisBuilder reads this config instead of checking chartType with ad-hoc conditionals.
 */
/**
 * Declares which settings panels are visible for each ECharts-based chart type.
 * Non-ECharts types (geo, pivot, trend) have their own axis builders and are not listed here.
 */
interface ChartSettingsConfig {
  xAxisSettings: boolean
  yAxisSettings: boolean
  style: boolean
  annotations: boolean
}

const CHART_SETTINGS: Record<string, ChartSettingsConfig> = {
  line:      { xAxisSettings: false, yAxisSettings: true,  style: true,  annotations: true  },
  bar:       { xAxisSettings: false, yAxisSettings: true,  style: true,  annotations: true  },
  area:      { xAxisSettings: false, yAxisSettings: true,  style: true,  annotations: true  },
  scatter:   { xAxisSettings: true,  yAxisSettings: true,  style: true,  annotations: true  },
  funnel:    { xAxisSettings: false, yAxisSettings: false, style: true,  annotations: false },
  pie:       { xAxisSettings: false, yAxisSettings: false, style: true,  annotations: false },
  waterfall: { xAxisSettings: false, yAxisSettings: true,  style: true,  annotations: false },
  combo:     { xAxisSettings: false, yAxisSettings: true,  style: true,  annotations: false },
  radar:     { xAxisSettings: false, yAxisSettings: false, style: true,  annotations: false },
}

const DEFAULT_SETTINGS: ChartSettingsConfig = { xAxisSettings: false, yAxisSettings: true, style: true, annotations: false }

interface AxisBuilderProps {
  columns: string[]
  types: string[]
  zones: AxisZone[]
  columnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatChange?: (column: string, config: ColumnFormatConfig) => void
  /** d3 vocabulary format popovers (Viz V2 surfaces). */
  d3Formats?: boolean
  children?: React.ReactNode
  stylePanel?: React.ReactNode
  annotationPanel?: React.ReactNode
  axisConfig?: AxisConfig
  onAxisConfigChange?: (config: AxisConfig) => void
  chartType?: string
  /** When true, removes card styling (border, bg, padding) for inline embedding */
  borderless?: boolean
}

const AxisSettingsPanel = ({ axis, axisConfig, onChange }: {
  axis: 'x' | 'y'
  axisConfig: AxisConfig
  onChange: (config: AxisConfig) => void
}) => {
  const scaleKey = axis === 'x' ? 'xScale' : 'yScale'
  const minKey = axis === 'x' ? 'xMin' : 'yMin'
  const maxKey = axis === 'x' ? 'xMax' : 'yMax'
  const currentScale = axisConfig[scaleKey] ?? 'linear'
  const currentMin = axisConfig[minKey]
  const currentMax = axisConfig[maxKey]
  const currentTitle = axis === 'y' ? axisConfig.yTitle ?? '' : ''

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2.5">
      <div className={`flex items-center gap-4 ${axis === 'y' ? 'justify-between' : 'justify-end'}`}>
        {axis === 'y' && (
          <div className="flex items-center gap-2">
            <span className={SECTION_LABEL}>
              Dual Y-axis
            </span>
            <Switch
              aria-label="Dual Y-axis toggle"
              checked={!!axisConfig.dualAxis}
              onCheckedChange={(checked) => { onChange({ ...axisConfig, dualAxis: checked || null }) }}
              className="data-[state=checked]:bg-[#16a085]"
            />
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className={SECTION_LABEL}>
            Scale
          </span>
          {(['linear', 'log'] as const).map(scale => (
            <div
              key={scale}
              className={`cursor-pointer rounded-sm border px-2 py-0.5 text-center font-mono text-xs transition-all duration-150 ${
                currentScale === scale
                  ? 'border-[#16a085] bg-[#16a085] font-bold text-white'
                  : 'border-border bg-card font-medium text-foreground hover:bg-muted'
              }`}
              onClick={(e) => { e.stopPropagation(); onChange({ ...axisConfig, [scaleKey]: scale }) }}
              aria-label={`${axis.toUpperCase()} axis ${scale} scale`}
            >
              {scale}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-2">
        {axis === 'y' && (
          <div className="flex-[2]">
            <div className={`${SECTION_LABEL} mb-1`}>
              Title
            </div>
            <input
              type="text"
              placeholder="auto"
              value={currentTitle}
              onChange={(e) => {
                const value = e.target.value
                onChange({ ...axisConfig, yTitle: value || null })
              }}
              onClick={(e) => e.stopPropagation()}
              className={INPUT_CLASSES}
            />
          </div>
        )}
        <div className="flex-1">
          <div className={`${SECTION_LABEL} mb-1`}>
            Min
          </div>
          <input
            type="number"
            placeholder="auto"
            value={currentMin ?? ''}
            onChange={(e) => {
              const val = e.target.value === '' ? undefined : Number(e.target.value)
              onChange({ ...axisConfig, [minKey]: val ?? null })
            }}
            onClick={(e) => e.stopPropagation()}
            className={INPUT_CLASSES}
          />
        </div>
        <div className="flex-1">
          <div className={`${SECTION_LABEL} mb-1`}>
            Max
          </div>
          <input
            type="number"
            placeholder="auto"
            value={currentMax ?? ''}
            onChange={(e) => {
              const val = e.target.value === '' ? undefined : Number(e.target.value)
              onChange({ ...axisConfig, [maxKey]: val ?? null })
            }}
            onClick={(e) => e.stopPropagation()}
            className={INPUT_CLASSES}
          />
        </div>
      </div>
    </div>
  )
}

export const AxisBuilder = ({ columns, types, zones, columnFormats, onColumnFormatChange, d3Formats, children, stylePanel, annotationPanel, axisConfig, onAxisConfigChange, chartType, borderless = false }: AxisBuilderProps) => {
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [dragSourceZone, setDragSourceZone] = useState<AxisZone | null>(null)
  const [selectedColumnForMobile, setSelectedColumnForMobile] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'fields' | 'settings'>('fields')
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({
    xAxis: false,
    yAxis: false,
    style: false,
    annotations: true,
  })
  const isTouchDevice = useIsTouchDevice()
  // Track whether a drop landed on a zone (set in onDrop, read in onDragEnd)
  const dropLandedRef = useRef(false)
  // Track pending source removal (deferred to onDragEnd so fresh zone closures are used)
  const pendingRemoveRef = useRef<{ column: string; zoneLabel: string } | null>(null)
  // Keep a ref to the latest zones so deferred removal can use fresh closures
  const zonesRef = useRef(zones)

  useEffect(() => { zonesRef.current = zones }, [zones])

  // Compute assigned columns from all zones
  const assignedColumns = useMemo(() => {
    const set = new Set<string>()
    zones.forEach(zone => zone.items.forEach(item => set.add(item.column)))
    return set
  }, [zones])

  const handleDragStart = useCallback((e: React.DragEvent, column: string) => {
    setDraggedColumn(column)
    dropLandedRef.current = false
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', column)
  }, [])

  const handleDragEnd = useCallback(() => {
    // If dragged from a zone and drop did NOT land on any zone → remove (drag outside)
    if (dragSourceZone && draggedColumn && !dropLandedRef.current) {
      dragSourceZone.onRemove(draggedColumn)
    }
    // If a zone-to-zone move is pending, defer source removal to after React
    // re-renders with the onDrop state, so zonesRef has fresh closures
    if (pendingRemoveRef.current) {
      requestAnimationFrame(() => {
        if (pendingRemoveRef.current) {
          const { column, zoneLabel } = pendingRemoveRef.current
          const freshZone = zonesRef.current.find(z => z.label === zoneLabel)
          freshZone?.onRemove(column)
          pendingRemoveRef.current = null
        }
      })
    }
    setDraggedColumn(null)
    setDragSourceZone(null)
    dropLandedRef.current = false
  }, [dragSourceZone, draggedColumn])

  const handleZoneChipDragStart = useCallback((e: React.DragEvent, column: string, sourceZone: AxisZone) => {
    setDraggedColumn(column)
    setDragSourceZone(sourceZone)
    dropLandedRef.current = false
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', column)
  }, [])

  const handleMobileSelect = useCallback((column: string) => {
    setSelectedColumnForMobile(prev => prev === column ? null : column)
  }, [])

  const handleZoneDrop = useCallback((zone: AxisZone) => {
    const col = draggedColumn || selectedColumnForMobile
    if (col) {
      dropLandedRef.current = true
      zone.onDrop(col)
      // Defer source removal to handleDragEnd so it uses fresh zone closures
      // (avoids stale state when source.onRemove and target.onDrop share a state setter)
      if (dragSourceZone && dragSourceZone.label !== zone.label) {
        pendingRemoveRef.current = { column: col, zoneLabel: dragSourceZone.label }
      }
    }
    setDraggedColumn(null)
    setSelectedColumnForMobile(null)
  }, [draggedColumn, selectedColumnForMobile, dragSourceZone])

  const cfg = CHART_SETTINGS[chartType ?? ''] ?? DEFAULT_SETTINGS
  const showXAxisSettings = cfg.xAxisSettings && !!onAxisConfigChange
  const showYAxisSettings = cfg.yAxisSettings && !!onAxisConfigChange
  const showStylePanel = cfg.style && !!stylePanel
  const showAnnotationPanel = cfg.annotations && !!annotationPanel
  const hasSettingsTab = showXAxisSettings || showYAxisSettings || showStylePanel || showAnnotationPanel

  const togglePanel = (key: 'xAxis' | 'yAxis' | 'style' | 'annotations') => {
    setCollapsedPanels(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderSettingsCard = (title: string, panelKey: 'xAxis' | 'yAxis' | 'style' | 'annotations', children: React.ReactNode) => {
    const collapsed = collapsedPanels[panelKey]
    return (
      <div
        className={`flex min-w-0 flex-col items-stretch rounded-md border border-border bg-card p-3 ${collapsed ? 'gap-0' : 'gap-2.5'}`}
      >
        <div
          className="flex cursor-pointer select-none items-center justify-between"
          onClick={() => togglePanel(panelKey)}
          role="button"
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          <span className={SECTION_LABEL}>
            {title}
          </span>
          <span className="text-muted-foreground">
            {collapsed ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
          </span>
        </div>
        {!collapsed && children}
      </div>
    )
  }

  return (
    <div
      className={`flex w-full flex-col gap-0 ${borderless ? 'border-none bg-transparent p-0' : 'rounded-md border border-border bg-background p-3'}`}
    >
      {/* Full-width 50/50 tab bar */}
      {hasSettingsTab && (
        <div className="mb-3 flex max-w-[240px] items-center gap-0 rounded-md bg-muted p-0.5">
          {([{ key: 'fields', icon: LuLayoutGrid, label: 'Fields' }, { key: 'settings', icon: LuSettings2, label: 'Settings' }] as const).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
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
      )}

      {(!hasSettingsTab || activeTab === 'fields') && (
        <div className="flex flex-col items-stretch gap-3">
        <div className="relative rounded-md bg-muted p-2 pt-3">
          <span className={`${SECTION_LABEL} absolute -top-2 rounded-sm bg-muted px-1.5`}>
            Columns
          </span>
        <div className="flex flex-wrap items-center gap-2">
          {columns.map(col => (
            <ColumnChip
              key={col}
              column={col}
              type={resolveColumnType(col, columns, types)}
              isAssigned={assignedColumns.has(col)}
              isDragging={draggedColumn === col}
              isMobileSelected={selectedColumnForMobile === col}
              isTouchDevice={isTouchDevice}
              onDragStart={(e) => handleDragStart(e, col)}
              onDragEnd={handleDragEnd}
              onMobileSelect={() => handleMobileSelect(col)}
            />
          ))}
          {children}
        </div>
        </div>

        {isTouchDevice && selectedColumnForMobile && (
          <div className="rounded-md bg-[#16a085]/10 p-2 text-center">
            <p className="text-xs font-semibold text-[#16a085]">
              Tap a zone below to add &quot;{selectedColumnForMobile}&quot;
            </p>
          </div>
        )}

        <div className="grid min-w-0 grid-cols-2 gap-2">
          {zones.map(zone => (
              <div key={zone.label} className="flex min-w-0 items-stretch">
                <DropZone
                  label={zone.label}
                  onDrop={() => handleZoneDrop(zone)}
                  isTouchDevice={isTouchDevice}
                >
                  <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
                    {zone.items.map(item => (
                      <ZoneChip
                        key={item.column}
                        column={item.column}
                        type={resolveColumnType(item.column, columns, types)}
                        onRemove={() => zone.onRemove(item.column)}
                        extra={item.extra}
                        formatConfig={columnFormats?.[item.column]}
                        onFormatChange={onColumnFormatChange ? (config) => onColumnFormatChange(item.column, config) : undefined}
                        d3Formats={d3Formats}
                        onDragStart={(e) => handleZoneChipDragStart(e, item.column, zone)}
                        onDragEnd={handleDragEnd}
                      />
                    ))}
                  </div>
                  {zone.items.length === 0 && (
                    <p className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs italic text-muted-foreground">
                      {zone.emptyText || 'Drop columns here'}
                    </p>
                  )}
                </DropZone>
              </div>
          ))}
        </div>
        </div>
      )}

      {hasSettingsTab && activeTab === 'settings' && (
        <div className="flex min-w-0 flex-col items-stretch gap-3">
          {showXAxisSettings && onAxisConfigChange && (
            renderSettingsCard('X Axis', 'xAxis',
              <AxisSettingsPanel axis="x" axisConfig={axisConfig ?? {}} onChange={onAxisConfigChange} />
            )
          )}
          {showYAxisSettings && onAxisConfigChange && (
            renderSettingsCard('Y Axis', 'yAxis',
              <AxisSettingsPanel axis="y" axisConfig={axisConfig ?? {}} onChange={onAxisConfigChange} />
            )
          )}
          {showStylePanel && stylePanel ? (
            renderSettingsCard('Style', 'style',
              stylePanel
            )
          ) : null}
          {showAnnotationPanel && annotationPanel ? (
            renderSettingsCard('Annotations', 'annotations',
              annotationPanel
            )
          ) : null}
        </div>
      )}
    </div>
  )
}
