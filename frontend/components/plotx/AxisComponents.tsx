'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { LuHash, LuCalendar, LuType, LuX, LuSettings2, LuBraces } from 'react-icons/lu'
import { getColumnType } from '@/lib/database/duckdb'
import { DATE_FORMAT_OPTIONS, D3_NUMBER_PRESETS, D3_DATE_PRESETS } from '@/lib/chart/chart-format'
import type { ColumnFormatConfig } from '@/lib/types'

// Shared types
export type ColumnType = 'date' | 'number' | 'text' | 'json'

// Tiny section label used throughout the axis-builder chrome (Chakra 2xs/700/0.05em)
const SECTION_LABEL = 'text-[10px] font-bold uppercase tracking-wider text-muted-foreground'

// Static per-type icon map (module scope, so JSX usage isn't a render-created component)
const TYPE_ICONS: Record<ColumnType, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  number: LuHash,
  date: LuCalendar,
  json: LuBraces,
  text: LuType,
}

const getTypeColor = (type: ColumnType) => {
  switch (type) {
    case 'number': return '#2980b9' // Primary blue
    case 'date': return '#9b59b6'   // Purple
    case 'json': return '#1abc9c'   // Turquoise/teal
    case 'text': return '#f39c12'   // Orange
  }
}

export const resolveColumnType = (col: string, columns: string[], types: string[]): ColumnType => {
  const idx = columns.indexOf(col)
  return types?.[idx] ? getColumnType(types[idx]) : 'text'
}

// Shared hook for touch device detection
export const useIsTouchDevice = () => {
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  // Detect touch support after mount — intentional setState in effect
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0)
  }, [])
  return isTouchDevice
}

// Draggable column chip (source palette)
interface ColumnChipProps {
  column: string
  type: ColumnType
  isAssigned?: boolean
  isDragging?: boolean
  isMobileSelected?: boolean
  isTouchDevice?: boolean
  /** False renders an informational field chip (no drag/tap assignment). */
  interactive?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  onMobileSelect?: () => void
}

export const ColumnChip = ({
  column, type, isAssigned, isDragging, isMobileSelected, isTouchDevice,
  interactive = true, onDragStart, onDragEnd, onMobileSelect,
}: ColumnChipProps) => {
  const Icon = TYPE_ICONS[type]
  const color = getTypeColor(type)

  const stateClasses = isMobileSelected
    ? 'border-[#16a085] bg-[#16a085]'
    : isAssigned
      ? `border-[#16a085] bg-muted`
      : `border-border bg-transparent ${interactive ? 'hover:bg-muted' : ''}`
  const cursorClasses = interactive
    ? (isTouchDevice ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing')
    : 'cursor-default'

  return (
    <div
      aria-label={`Column chip ${column}`}
      className={`flex shrink-0 select-none items-center gap-1.5 rounded-md border px-2 py-1 ${stateClasses} ${cursorClasses} ${isDragging ? 'opacity-40' : 'opacity-100'}`}
      draggable={interactive && !isTouchDevice}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => interactive && isTouchDevice && onMobileSelect?.()}
    >
      <Icon className="shrink-0 text-sm" style={{ color: isMobileSelected ? 'white' : color }} />
      <span className={`select-none whitespace-nowrap font-mono text-xs ${isMobileSelected ? 'text-white' : 'text-foreground'}`}>
        {column}
      </span>
    </div>
  )
}

// Drop zone container
interface DropZoneProps {
  label: string
  onDrop: () => void
  isTouchDevice?: boolean
  children: React.ReactNode
  labelExtra?: React.ReactNode
}

export const DropZone = ({ label, onDrop, isTouchDevice, children, labelExtra }: DropZoneProps) => {
  const [isDragOver, setIsDragOver] = useState(false)

  return (
    <div
      aria-label={`${label} drop zone`}
      className={`relative flex min-h-[44px] min-w-0 flex-1 flex-col items-stretch gap-1 overflow-visible rounded-md border-2 border-dashed p-2 pt-3 transition-[border-color,background] duration-150 ${
        isDragOver ? 'border-[#16a085] bg-[#16a085]/10' : 'border-border bg-card'
      } ${isTouchDevice ? 'cursor-pointer' : 'cursor-default'}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragOver(false); onDrop() }}
      onClick={() => isTouchDevice && onDrop()}
    >
      <div
        className={`absolute -top-2.5 flex items-center gap-1 rounded-sm border border-dashed bg-muted px-1.5 ${
          isDragOver ? 'border-[#16a085]' : 'border-border'
        }`}
      >
        <span className={SECTION_LABEL}>
          {label}
        </span>
        {labelExtra}
      </div>
      <div className="w-full min-w-0">
        {children}
      </div>
    </div>
  )
}

// Format popover content (shown on ZoneChip click)
const DECIMAL_OPTIONS = [0, 1, 2, 3, 4] as const

const PRESET_DATE_FORMATS = DATE_FORMAT_OPTIONS.map(o => o.value as string)

const INPUT_CLASSES = 'w-full rounded border border-border bg-transparent px-2 py-1 font-mono text-xs text-inherit outline-none'

const DateFormatPicker = ({ dateFormat, onChange }: { dateFormat?: string | null, onChange: (v: string | undefined) => void }) => {
  const isCustom = dateFormat != null && !PRESET_DATE_FORMATS.includes(dateFormat)
  const [customValue, setCustomValue] = useState(isCustom ? dateFormat : '')
  const [showCustom, setShowCustom] = useState(isCustom)

  return (
    <div>
      <div className={`${SECTION_LABEL} mb-1`}>
        Date Format
      </div>
      <div className="flex flex-col items-stretch">
        {DATE_FORMAT_OPTIONS.map(fmt => (
          <div
            key={fmt.value}
            className={`cursor-pointer rounded-sm px-2 py-1 transition-[background] duration-150 ${
              dateFormat === fmt.value ? 'bg-[#16a085]/15' : 'bg-transparent hover:bg-muted'
            }`}
            onClick={(e) => { e.stopPropagation(); setShowCustom(false); onChange(dateFormat === fmt.value ? undefined : fmt.value) }}
          >
            <span className={`font-mono text-xs ${dateFormat === fmt.value ? 'font-bold text-[#16a085]' : 'font-medium text-foreground'}`}>
              {fmt.label}
            </span>
          </div>
        ))}
        {/* Custom format option */}
        <div
          className={`cursor-pointer rounded-sm px-2 py-1 transition-[background] duration-150 ${
            showCustom ? 'bg-[#16a085]/15' : 'bg-transparent hover:bg-muted'
          }`}
          onClick={(e) => { e.stopPropagation(); setShowCustom(true) }}
        >
          <span className={`font-mono text-xs ${showCustom ? 'font-bold text-[#16a085]' : 'font-medium text-foreground'}`}>
            Custom…
          </span>
        </div>
        {showCustom && (
          <div className="px-2 py-1">
            <input
              aria-label="Custom date format"
              type="text"
              placeholder="e.g. dd/MM/yyyy HH:mm"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onBlur={() => { onChange(customValue || undefined) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { onChange(customValue || undefined) } }}
              onClick={(e) => e.stopPropagation()}
              className={INPUT_CLASSES}
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              yyyy MM dd HH mm ss MMM MMMM
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

interface FormatPopoverProps {
  type: ColumnType
  column: string
  formatConfig: ColumnFormatConfig
  onChange: (config: ColumnFormatConfig) => void
  /** d3 vocabulary (Viz V2 surfaces): presets + a custom d3 pattern instead of prefix/suffix/decimals. */
  d3Formats?: boolean
}

/** d3-mode format section: preset chips + always-visible custom pattern input. */
const D3FormatSection = ({ type, column, config, onChange }: {
  type: ColumnType
  column: string
  config: ColumnFormatConfig
  onChange: (config: ColumnFormatConfig) => void
}) => {
  const [draft, setDraft] = useState<string | null>(null)
  const presets = type === 'date' ? D3_DATE_PRESETS : D3_NUMBER_PRESETS
  // Writing a d3 format clears the legacy fields — one vocabulary at a time.
  const commit = (format: string | null) => onChange({
    alias: config.alias,
    format: format && format.trim() !== '' ? format.trim() : undefined,
  })

  return (
    <div>
      <div className={`${SECTION_LABEL} mb-1`}>
        Format
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {presets.map(({ label, format }) => (
          <button
            key={label}
            type="button"
            aria-label={`Format ${label}`}
            className={`cursor-pointer rounded-sm border px-1.5 py-0.5 font-mono text-xs transition-all duration-150 ${
              (config.format ?? null) === format
                ? 'border-[#16a085] bg-[#16a085] font-bold text-white'
                : 'border-border bg-card font-medium text-foreground hover:bg-muted'
            }`}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setDraft(null); commit(format) }}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        type="text"
        aria-label={`Custom d3 format for ${column}`}
        placeholder={type === 'date' ? 'custom d3, e.g. %b %d' : 'custom d3, e.g. .2~s'}
        value={draft ?? config.format ?? ''}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft != null) { commit(draft); setDraft(null) } }}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit((e.target as HTMLInputElement).value); setDraft(null) } }}
        onClick={(e) => e.stopPropagation()}
        className={`${INPUT_CLASSES} mt-1.5`}
      />
    </div>
  )
}

export const FormatPopover = ({ type, column, formatConfig, onChange, d3Formats }: FormatPopoverProps) => {
  const config = formatConfig

  const handleAliasChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...config, alias: e.target.value || undefined })
  }, [config, onChange])

  const handlePrefixChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...config, prefix: e.target.value })
  }, [config, onChange])

  const handleSuffixChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...config, suffix: e.target.value })
  }, [config, onChange])

  const inputClasses = `${INPUT_CLASSES} bg-card text-foreground`

  return (
    <div className="flex min-w-[180px] flex-col items-stretch gap-2.5 p-2.5">
      {/* Alias */}
      <div>
        <div className={`${SECTION_LABEL} mb-1`}>
          Alias
        </div>
        <input
          type="text"
          aria-label={`Alias for ${column}`}
          placeholder={column}
          value={config.alias || ''}
          onChange={handleAliasChange}
          onClick={(e) => e.stopPropagation()}
          className={inputClasses}
        />
      </div>

      {/* d3 vocabulary (Viz V2): one format pattern for numbers AND dates */}
      {d3Formats && (type === 'number' || type === 'date') && (
        <D3FormatSection type={type} column={column} config={config} onChange={onChange} />
      )}

      {/* Prefix & Suffix - shown for number type */}
      {!d3Formats && type === 'number' && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className={`${SECTION_LABEL} mb-1`}>
              Prefix
            </div>
            <input
              type="text"
              placeholder="e.g. $"
              value={config.prefix || ''}
              onChange={handlePrefixChange}
              onClick={(e) => e.stopPropagation()}
              className={inputClasses}
            />
          </div>
          <div className="flex-1">
            <div className={`${SECTION_LABEL} mb-1`}>
              Suffix
            </div>
            <input
              type="text"
              placeholder="e.g. %"
              value={config.suffix || ''}
              onChange={handleSuffixChange}
              onClick={(e) => e.stopPropagation()}
              className={inputClasses}
            />
          </div>
        </div>
      )}

      {/* Decimal points - shown for number type */}
      {!d3Formats && type === 'number' && (
        <div>
          <div className={`${SECTION_LABEL} mb-1`}>
            Decimal Places
          </div>
          <div className="flex items-center gap-1">
            {DECIMAL_OPTIONS.map(n => (
              <div
                key={n}
                className={`min-w-[28px] cursor-pointer rounded-sm border px-2 py-0.5 text-center font-mono text-xs transition-all duration-150 ${
                  config.decimalPoints === n
                    ? 'border-[#16a085] bg-[#16a085] font-bold text-white'
                    : 'border-border bg-card font-medium text-foreground hover:bg-muted'
                }`}
                onClick={(e) => { e.stopPropagation(); onChange({ ...config, decimalPoints: config.decimalPoints === n ? undefined : n }) }}
              >
                {n}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Date format - shown for date type */}
      {!d3Formats && type === 'date' && (
        <DateFormatPicker dateFormat={config.dateFormat} onChange={(dateFormat) => onChange({ ...config, dateFormat })} />
      )}
    </div>
  )
}

// Chip inside a drop zone (removable, with optional format popover)
interface ZoneChipProps {
  column: string
  type: ColumnType
  onRemove: () => void
  /** Extra content to render after the column name (e.g., aggregation selector) */
  extra?: React.ReactNode
  formatConfig?: ColumnFormatConfig
  onFormatChange?: (config: ColumnFormatConfig) => void
  /** d3 vocabulary popover (Viz V2 surfaces). */
  d3Formats?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
}

export const ZoneChip = ({ column, type, onRemove, extra, formatConfig, onFormatChange, d3Formats, onDragStart, onDragEnd }: ZoneChipProps) => {
  const Icon = TYPE_ICONS[type]
  const color = getTypeColor(type)
  const [showPopover, setShowPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLDivElement>(null)

  const displayName = formatConfig?.alias || column
  const hasFormat = formatConfig && (formatConfig.alias || formatConfig.decimalPoints !== undefined || formatConfig.dateFormat || formatConfig.prefix || formatConfig.suffix)

  // Close popover on click outside
  useEffect(() => {
    if (!showPopover) return
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        chipRef.current && !chipRef.current.contains(e.target as Node)
      ) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPopover])

  const handleFormatChange = useCallback((config: ColumnFormatConfig) => {
    onFormatChange?.(config)
  }, [onFormatChange])

  return (
    <div ref={chipRef} className="relative min-w-0 max-w-full flex-[0_1_auto]">
      <div
        aria-label={`Zone chip ${column}`}
        className={`flex min-w-0 max-w-full cursor-grab select-none items-center gap-1.5 overflow-hidden rounded-md border bg-muted px-2 py-1 active:cursor-grabbing ${
          hasFormat ? 'border-[#16a085]' : 'border-border'
        }`}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <Icon className="shrink-0 text-sm" style={{ color }} />
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-foreground">
          {displayName}
        </span>
        {extra}
        {onFormatChange && (
          <button
            type="button"
            aria-label={`Format column ${column}`}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setShowPopover(!showPopover) }}
            className={`ml-0.5 shrink-0 transition-colors duration-200 hover:text-[#16a085] ${
              hasFormat ? 'text-[#16a085]' : 'text-muted-foreground'
            }`}
          >
            <LuSettings2 size={12} />
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove ${column}`}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove() }}
          className={`shrink-0 transition-colors duration-200 hover:text-[#c0392b] ${onFormatChange ? 'ml-0' : 'ml-0.5'}`}
        >
          <LuX size={12} />
        </button>
      </div>

      {/* Format popover */}
      {showPopover && onFormatChange && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full z-20 mt-1 rounded-md border border-border bg-popover shadow-md"
        >
          <FormatPopover
            type={type}
            column={column}
            formatConfig={formatConfig || {}}
            onChange={handleFormatChange}
            d3Formats={d3Formats}
          />
        </div>
      )}
    </div>
  )
}
