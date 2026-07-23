'use client'

import { useState, useCallback } from 'react'
import { ColumnChip, DropZone, ZoneChip, resolveColumnType, useIsTouchDevice } from './AxisComponents'
import type { ColumnFormatConfig, TrendConfig, TrendCompareMode } from '@/lib/types'

interface TrendAxisBuilderProps {
  columns: string[]
  types: string[]
  xAxisColumns: string[]
  yAxisColumns: string[]
  onAxisChange: (xCols: string[], yCols: string[]) => void
  columnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatChange?: (column: string, config: ColumnFormatConfig) => void
  trendConfig?: TrendConfig
  onTrendConfigChange?: (config: TrendConfig) => void
}

const COMPARE_OPTIONS: { value: TrendCompareMode; label: string }[] = [
  { value: 'last', label: 'Latest vs Previous' },
  { value: 'previous', label: 'Previous vs Before (skip latest)' },
]

export const TrendAxisBuilder = ({
  columns, types, xAxisColumns, yAxisColumns, onAxisChange,
  columnFormats, onColumnFormatChange, trendConfig, onTrendConfigChange,
}: TrendAxisBuilderProps) => {
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const isTouchDevice = useIsTouchDevice()
  const [selectedColumnForMobile, setSelectedColumnForMobile] = useState<string | null>(null)

  const assignedColumns = new Set([...xAxisColumns, ...yAxisColumns])
  const compareMode = trendConfig?.compareMode ?? 'last'

  const handleDragStart = useCallback((e: React.DragEvent, col: string) => {
    setDraggedColumn(col)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', col)
  }, [])

  const handleDragEnd = useCallback(() => { setDraggedColumn(null) }, [])

  const handleXDrop = useCallback((col: string) => {
    if (!xAxisColumns.includes(col)) onAxisChange([...xAxisColumns, col], yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const handleYDrop = useCallback((col: string) => {
    if (!yAxisColumns.includes(col)) onAxisChange(xAxisColumns, [...yAxisColumns, col])
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const handleXRemove = useCallback((col: string) => {
    onAxisChange(xAxisColumns.filter(c => c !== col), yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const handleYRemove = useCallback((col: string) => {
    onAxisChange(xAxisColumns, yAxisColumns.filter(c => c !== col))
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  return (
    <div className="flex w-full flex-col gap-3">
      {/* Column chips */}
      <div className="relative rounded-md bg-muted p-2 pt-3">
        <span className="absolute -top-2 rounded-sm bg-muted px-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
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
              onMobileSelect={() => setSelectedColumnForMobile(prev => prev === col ? null : col)}
            />
          ))}
        </div>
      </div>

      {/* Drop zones */}
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <div className="flex min-w-0 items-stretch">
          <DropZone
            label="Time Axis"
            onDrop={() => {
              const col = draggedColumn || selectedColumnForMobile
              if (col) handleXDrop(col)
              setDraggedColumn(null)
              setSelectedColumnForMobile(null)
            }}
            isTouchDevice={isTouchDevice}
          >
            <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
              {xAxisColumns.map(col => (
                <ZoneChip
                  key={col}
                  column={col}
                  type={resolveColumnType(col, columns, types)}
                  onRemove={() => handleXRemove(col)}
                  formatConfig={columnFormats?.[col]}
                  onFormatChange={onColumnFormatChange ? (config) => onColumnFormatChange(col, config) : undefined}
                />
              ))}
            </div>
            {xAxisColumns.length === 0 && (
              <p className="text-xs italic text-muted-foreground">Drop a date/time column</p>
            )}
          </DropZone>
        </div>
        <div className="flex min-w-0 items-stretch">
          <DropZone
            label="Metrics"
            onDrop={() => {
              const col = draggedColumn || selectedColumnForMobile
              if (col) handleYDrop(col)
              setDraggedColumn(null)
              setSelectedColumnForMobile(null)
            }}
            isTouchDevice={isTouchDevice}
          >
            <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
              {yAxisColumns.map(col => (
                <ZoneChip
                  key={col}
                  column={col}
                  type={resolveColumnType(col, columns, types)}
                  onRemove={() => handleYRemove(col)}
                  formatConfig={columnFormats?.[col]}
                  onFormatChange={onColumnFormatChange ? (config) => onColumnFormatChange(col, config) : undefined}
                />
              ))}
            </div>
            {yAxisColumns.length === 0 && (
              <p className="text-xs italic text-muted-foreground">Drop metric columns</p>
            )}
          </DropZone>
        </div>
      </div>

      {/* Comparison mode */}
      {onTrendConfigChange && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Compare
          </span>
          <div className="flex items-center gap-1">
            {COMPARE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`cursor-pointer rounded-md px-2 py-1 font-mono text-xs transition-all duration-150 ${
                  compareMode === opt.value
                    ? 'bg-[#16a085] font-bold text-white'
                    : 'bg-transparent font-medium text-muted-foreground hover:bg-muted'
                }`}
                onClick={() => onTrendConfigChange({ ...trendConfig, compareMode: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
