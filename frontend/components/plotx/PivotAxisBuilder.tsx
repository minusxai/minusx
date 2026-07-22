'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { LuChevronDown, LuChevronRight, LuLayoutGrid, LuSettings2 } from 'react-icons/lu'
import { Checkbox } from '@/components/kit/checkbox'
import { resolveColumnType } from './AxisComponents'
import { AxisBuilder, type AxisZone } from './AxisBuilder'
import { FormulaBuilder, type DimensionInfo } from './FormulaBuilder'
import { ColorScalePicker } from './ColorScalePicker'
import type { PivotConfig, PivotValueConfig, PivotFormula, AggregationFunction, ColumnFormatConfig } from '@/lib/types'

const AGG_FUNCTIONS: AggregationFunction[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']

// Tiny section label (Chakra 2xs/700/0.05em equivalent)
const SECTION_LABEL = 'text-[10px] font-bold uppercase tracking-wider text-muted-foreground'

interface PivotAxisBuilderProps {
  columns: string[]
  types: string[]
  pivotConfig?: PivotConfig
  onPivotConfigChange: (config: PivotConfig) => void
  useCompactView?: boolean
  availableRowValues?: string[]
  availableColumnValues?: string[]
  columnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatChange?: (column: string, config: ColumnFormatConfig) => void
  /** d3 vocabulary format popovers (Viz V2 surfaces). */
  d3Formats?: boolean
  /** Render ONE section without the internal tab bar — the host panel owns the
   * tabs (V2 VegaVizPanel: Fields tab → 'fields', Settings tab → 'settings').
   * Omit for the classic self-tabbed layout. */
  section?: 'fields' | 'settings'
  rowDimensions?: DimensionInfo[]
  getRowValuesAtLevel?: (level: number, parentValues?: string[]) => string[]
}

export const PivotAxisBuilder = ({
  columns,
  types,
  pivotConfig,
  onPivotConfigChange,
  availableRowValues,
  availableColumnValues,
  columnFormats,
  onColumnFormatChange,
  d3Formats,
  section,
  rowDimensions,
  getRowValuesAtLevel,
}: PivotAxisBuilderProps) => {
  // Classify columns for auto-init
  const groupedColumns = useMemo(() => {
    const groups: { dates: string[]; numbers: string[]; categories: string[] } = {
      dates: [], numbers: [], categories: [],
    }
    columns.forEach((col) => {
      const type = resolveColumnType(col, columns, types)
      if (type === 'date') groups.dates.push(col)
      else if (type === 'number') groups.numbers.push(col)
      else groups.categories.push(col)
    })
    return groups
  }, [columns, types])

  // Auto-initialize when no pivotConfig
  const config: PivotConfig = useMemo(() => {
    if (pivotConfig) return pivotConfig

    const rowCols: string[] = []
    const colCols: string[] = []
    const vals: PivotValueConfig[] = []

    if (groupedColumns.dates.length > 0) {
      rowCols.push(groupedColumns.dates[0])
    } else if (groupedColumns.categories.length > 0) {
      rowCols.push(groupedColumns.categories[0])
    }

    const remainingCats = groupedColumns.categories.filter(c => !rowCols.includes(c))
    const remainingDates = groupedColumns.dates.filter(c => !rowCols.includes(c))
    if (remainingCats.length > 0) {
      colCols.push(remainingCats[0])
    } else if (remainingDates.length > 0) {
      colCols.push(remainingDates[0])
    }

    if (groupedColumns.numbers.length > 0) {
      vals.push({ column: groupedColumns.numbers[0], aggFunction: 'SUM' })
    }

    return { rows: rowCols, columns: colCols, values: vals, showRowTotals: false, showColumnTotals: false, showHeatmap: true }
  }, [pivotConfig, groupedColumns])

  // Fire initial config if auto-initialized
  useEffect(() => {
    if (!pivotConfig && config.values.length > 0) {
      onPivotConfigChange(config)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Drop handlers (receive column from AxisBuilder)
  const handleDropRows = useCallback((col: string) => {
    if (config.rows.includes(col)) return
    const newCols = config.columns.filter(c => c !== col)
    const newVals = config.values.filter(v => v.column !== col)
    const newRows = [...config.rows, col]
    const clearRowFormulas = config.rows.length === 0
    onPivotConfigChange({ ...config, rows: newRows, columns: newCols, values: newVals, ...(clearRowFormulas ? { rowFormulas: [] } : {}) })
  }, [config, onPivotConfigChange])

  const handleDropColumns = useCallback((col: string) => {
    if (config.columns.includes(col)) return
    const newRows = config.rows.filter(c => c !== col)
    const newVals = config.values.filter(v => v.column !== col)
    const newColumns = [...config.columns, col]
    const clearColFormulas = config.columns.length === 0
    onPivotConfigChange({ ...config, rows: newRows, columns: newColumns, values: newVals, ...(clearColFormulas ? { columnFormulas: [] } : {}) })
  }, [config, onPivotConfigChange])

  const handleDropValues = useCallback((col: string) => {
    if (config.values.some(v => v.column === col)) return
    const newRows = config.rows.filter(c => c !== col)
    const newCols = config.columns.filter(c => c !== col)
    onPivotConfigChange({ ...config, rows: newRows, columns: newCols, values: [...config.values, { column: col, aggFunction: 'SUM' }] })
  }, [config, onPivotConfigChange])

  // Remove handlers
  const removeFromRows = useCallback((col: string) => {
    const newRows = config.rows.filter(c => c !== col)
    const clearRowFormulas = config.rows[0] === col
    onPivotConfigChange({ ...config, rows: newRows, ...(clearRowFormulas ? { rowFormulas: [] } : {}) })
  }, [config, onPivotConfigChange])

  const removeFromColumns = useCallback((col: string) => {
    const newCols = config.columns.filter(c => c !== col)
    const clearColFormulas = config.columns[0] === col
    onPivotConfigChange({ ...config, columns: newCols, ...(clearColFormulas ? { columnFormulas: [] } : {}) })
  }, [config, onPivotConfigChange])

  const removeFromValues = useCallback((col: string) => {
    onPivotConfigChange({ ...config, values: config.values.filter(v => v.column !== col) })
  }, [config, onPivotConfigChange])

  // Change aggregation function
  const changeAggFunction = useCallback((col: string, fn: AggregationFunction) => {
    onPivotConfigChange({
      ...config,
      values: config.values.map(v => v.column === col ? { ...v, aggFunction: fn } : v),
    })
  }, [config, onPivotConfigChange])

  // Aggregation selector component for value zone chips
  const AggSelector = ({ column, aggFunction }: { column: string; aggFunction: AggregationFunction }) => {
    const [showMenu, setShowMenu] = useState(false)

    return (
      <div className="relative">
        <div
          className="flex cursor-pointer items-center gap-0.5 rounded-sm bg-[#16a085]/15 px-1.5 py-0.5 transition-all duration-150 hover:bg-[#16a085]/25"
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
        >
          <span className="text-[10px] font-bold text-[#16a085]">
            {aggFunction}
          </span>
          <LuChevronDown className="text-[10px] text-[#16a085]" />
        </div>
        {showMenu && (
          <div className="absolute left-0 top-full z-10 mt-1 flex min-w-[70px] flex-col items-center gap-0 rounded-md border border-border bg-popover p-1 shadow-md">
            {AGG_FUNCTIONS.map(fn => (
              <div
                key={fn}
                className={`w-full cursor-pointer rounded-sm px-2 py-1 hover:bg-[#16a085]/10 ${
                  fn === aggFunction ? 'bg-[#16a085]/15' : 'bg-transparent'
                }`}
                onClick={(e) => { e.stopPropagation(); changeAggFunction(column, fn); setShowMenu(false) }}
              >
                <span className={`text-xs ${fn === aggFunction ? 'font-bold text-[#16a085]' : 'font-medium text-foreground'}`}>
                  {fn}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Build zones config
  const zones: AxisZone[] = useMemo(() => [
    {
      label: 'Rows',
      items: config.rows.map(col => ({ column: col })),
      emptyText: 'Drop dimensions here',
      onDrop: handleDropRows,
      onRemove: removeFromRows,
    },
    {
      label: 'Columns',
      items: config.columns.map(col => ({ column: col })),
      emptyText: 'Drop dimensions here',
      onDrop: handleDropColumns,
      onRemove: removeFromColumns,
    },
    {
      label: 'Values',
      items: config.values.map(v => ({
        column: v.column,
        extra: <AggSelector column={v.column} aggFunction={v.aggFunction ?? 'SUM'} />,
      })),
      emptyText: 'Drop measures here',
      onDrop: handleDropValues,
      onRemove: removeFromValues,
    },
  ], [config, handleDropRows, handleDropColumns, handleDropValues, removeFromRows, removeFromColumns, removeFromValues])

  const showRowFormulas = config.rows.length > 0 && availableRowValues && availableRowValues.length >= 2
  const showColFormulas = config.columns.length > 0 && availableColumnValues && availableColumnValues.length >= 2

  const [activeTab, setActiveTab] = useState<'fields' | 'settings'>('fields')
  // When a host panel owns the tabs (the V2 VegaVizPanel), it renders one section
  // per host tab — the internal segmented control is hidden.
  const active = section ?? activeTab
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({
    options: false,
    formulas: false,
  })

  const togglePanel = (key: string) => {
    setCollapsedPanels(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderSettingsCard = (title: string, panelKey: string, children: React.ReactNode) => {
    const collapsed = collapsedPanels[panelKey]
    return (
      <div
        className={`flex min-w-0 flex-col items-stretch rounded-md border border-border bg-card p-3 ${collapsed ? 'gap-0' : 'gap-2.5'}`}
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

  return (
    <div className="flex flex-col items-stretch gap-0">
      {/* Tab bar — segmented control matching AxisBuilder (classic only; hidden
          when a host panel supplies `section`) */}
      {section == null && (
      <div className="mb-3 flex max-w-[240px] items-center gap-0 rounded-md bg-muted p-0.5">
        {([{ key: 'fields', icon: LuLayoutGrid, label: 'Fields' }, { key: 'settings', icon: LuSettings2, label: 'Settings' }] as const).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            type="button"
            aria-label={`Pivot ${key} section`}
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

      {/* Fields tab — AxisBuilder renders its own styled container */}
      {active === 'fields' && (
        <AxisBuilder columns={columns} types={types} zones={zones} columnFormats={columnFormats} onColumnFormatChange={onColumnFormatChange} d3Formats={d3Formats} borderless />
      )}

      {/* Settings tab */}
      {active === 'settings' && (
        <div className="flex flex-col gap-3">
          {renderSettingsCard('Options', 'options',
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  aria-label="Toggle row totals"
                  checked={config.showRowTotals !== false}
                  onCheckedChange={(checked) => onPivotConfigChange({ ...config, showRowTotals: checked === true })}
                />
                <span className="text-xs text-muted-foreground">Row Totals</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  aria-label="Toggle column totals"
                  checked={config.showColumnTotals !== false}
                  onCheckedChange={(checked) => onPivotConfigChange({ ...config, showColumnTotals: checked === true })}
                />
                <span className="text-xs text-muted-foreground">Column Totals</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  aria-label="Toggle heatmap"
                  checked={config.showHeatmap !== false}
                  onCheckedChange={(checked) => onPivotConfigChange({ ...config, showHeatmap: checked === true })}
                />
                <span className="text-xs text-muted-foreground">Heatmap</span>
              </label>
              {/* Compact (GitHub-graph) mode is legacy-only: on V2 (d3Formats) the
                  dedicated heatmap viz type replaces it. */}
              {!d3Formats && (
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={config.compact === true}
                  onCheckedChange={(checked) => onPivotConfigChange({ ...config, compact: checked === true })}
                />
                <span className="text-xs text-muted-foreground">Compact (GitHub Style)</span>
              </label>
              )}
              {config.showHeatmap !== false && (
                <ColorScalePicker
                  value={config.heatmapScale}
                  defaultScale="red-yellow-green"
                  onChange={(scale) => onPivotConfigChange({ ...config, heatmapScale: scale })}
                />
              )}
            </div>
          )}
          {(showRowFormulas || showColFormulas) && renderSettingsCard('Formulas', 'formulas',
            <div className="flex flex-col items-stretch gap-3">
              {showRowFormulas ? (
                <FormulaBuilder
                  axis="row"
                  formulas={config.rowFormulas || []}
                  availableValues={availableRowValues!}
                  dimensionName={config.rows[0]}
                  onChange={(formulas: PivotFormula[]) => onPivotConfigChange({ ...config, rowFormulas: formulas })}
                  dimensions={rowDimensions}
                  getValuesAtLevel={getRowValuesAtLevel}
                />
              ) : (
                <div className="flex flex-col items-start gap-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Row Formulas
                  </span>
                  <span className="text-xs italic text-muted-foreground">Add row dimensions first</span>
                </div>
              )}
              {showColFormulas ? (
                <FormulaBuilder
                  axis="column"
                  formulas={config.columnFormulas || []}
                  availableValues={availableColumnValues!}
                  dimensionName={config.columns[0]}
                  onChange={(formulas: PivotFormula[]) => onPivotConfigChange({ ...config, columnFormulas: formulas })}
                />
              ) : (
                <div className="flex flex-col items-start gap-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Column Formulas
                  </span>
                  <span className="text-xs italic text-muted-foreground">Add column dimensions first</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
