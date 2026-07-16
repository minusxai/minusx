'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { LuHash, LuCalendar, LuType, LuX, LuSettings2, LuBraces } from 'react-icons/lu'
import { getColumnType } from '@/lib/database/duckdb'
import { DATE_FORMAT_OPTIONS, D3_NUMBER_PRESETS, D3_DATE_PRESETS } from '@/lib/chart/chart-format'
import type { ColumnFormatConfig } from '@/lib/types'

// Shared types
export type ColumnType = 'date' | 'number' | 'text' | 'json'

const getTypeIcon = (type: ColumnType) => {
  switch (type) {
    case 'number': return LuHash
    case 'date': return LuCalendar
    case 'json': return LuBraces
    case 'text': return LuType
  }
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
  const Icon = getTypeIcon(type)
  const color = getTypeColor(type)

  return (
    <HStack
      aria-label={`Column chip ${column}`}
      gap={1.5}
      px={2}
      py={1}
      bg={isMobileSelected ? 'accent.teal' : isAssigned ? 'bg.muted' : 'transparent'}
      borderRadius="md"
      border="1px solid"
      borderColor={isMobileSelected ? 'accent.teal' : isAssigned ? 'accent.teal' : 'border.default'}
      cursor={interactive ? (isTouchDevice ? 'pointer' : 'grab') : 'default'}
      opacity={isDragging ? 0.4 : 1}
      _hover={interactive ? { bg: isMobileSelected ? 'accent.teal' : 'bg.muted', borderColor: isAssigned ? 'accent.teal' : 'border.default' } : undefined}
      _active={interactive ? { cursor: isTouchDevice ? 'pointer' : 'grabbing' } : undefined}
      draggable={interactive && !isTouchDevice}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => interactive && isTouchDevice && onMobileSelect?.()}
      userSelect="none"
      flexShrink={0}
    >
      <Box as={Icon} fontSize="sm" color={isMobileSelected ? 'white' : color} flexShrink={0} />
      <Text fontSize="xs" fontFamily="mono" color={isMobileSelected ? 'white' : 'fg.default'} whiteSpace="nowrap" userSelect="none">
        {column}
      </Text>
    </HStack>
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
    <VStack
      aria-label={`${label} drop zone`}
      flex="1"
      align="stretch"
      gap={1}
      p={2}
      pt={3}
      bg={isDragOver ? 'accent.teal/10' : 'bg.surface'}
      borderRadius="md"
      border="2px dashed"
      borderColor={isDragOver ? 'accent.teal' : 'border.muted'}
      position="relative"
      minH="44px"
      minW={0}
      overflow="visible"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragOver(false); onDrop() }}
      onClick={() => isTouchDevice && onDrop()}
      cursor={isTouchDevice ? 'pointer' : 'default'}
      transition="border-color 0.15s, background 0.15s"
    >
      <HStack
        gap={1}
        position="absolute"
        top={-2.5}
        bg="bg.muted"
        px={1.5}
        borderRadius="sm"
        border="1px dashed"
        borderColor={isDragOver ? 'accent.teal' : 'border.muted'}
        alignItems="center"
      >
        <Text
          fontSize="2xs"
          fontWeight="700"
          color="fg.subtle"
          textTransform="uppercase"
          letterSpacing="0.05em"
        >
          {label}
        </Text>
        {labelExtra}
      </HStack>
      <Box minW={0} width="100%">
        {children}
      </Box>
    </VStack>
  )
}

// Format popover content (shown on ZoneChip click)
const DECIMAL_OPTIONS = [0, 1, 2, 3, 4] as const

const PRESET_DATE_FORMATS = DATE_FORMAT_OPTIONS.map(o => o.value as string)

const DateFormatPicker = ({ dateFormat, onChange }: { dateFormat?: string | null, onChange: (v: string | undefined) => void }) => {
  const isCustom = dateFormat != null && !PRESET_DATE_FORMATS.includes(dateFormat)
  const [customValue, setCustomValue] = useState(isCustom ? dateFormat : '')
  const [showCustom, setShowCustom] = useState(isCustom)

  const inputStyle = {
    fontSize: '12px',
    fontFamily: 'var(--fonts-mono, monospace)',
    padding: '4px 8px',
    width: '100%',
    border: '1px solid var(--colors-border-muted, #333)',
    borderRadius: '4px',
    background: 'transparent',
    color: 'inherit',
    outline: 'none',
  } as const

  return (
    <Box>
      <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
        Date Format
      </Text>
      <VStack align="stretch" gap={0}>
        {DATE_FORMAT_OPTIONS.map(fmt => (
          <Box
            key={fmt.value}
            px={2}
            py={1}
            cursor="pointer"
            borderRadius="sm"
            bg={dateFormat === fmt.value ? 'accent.teal/15' : 'transparent'}
            _hover={{ bg: dateFormat === fmt.value ? 'accent.teal/15' : 'bg.muted' }}
            onClick={(e) => { e.stopPropagation(); setShowCustom(false); onChange(dateFormat === fmt.value ? undefined : fmt.value) }}
            transition="background 0.15s"
          >
            <Text fontSize="xs" fontFamily="mono" fontWeight={dateFormat === fmt.value ? '700' : '500'} color={dateFormat === fmt.value ? 'accent.teal' : 'fg.default'}>
              {fmt.label}
            </Text>
          </Box>
        ))}
        {/* Custom format option */}
        <Box
          px={2}
          py={1}
          cursor="pointer"
          borderRadius="sm"
          bg={showCustom ? 'accent.teal/15' : 'transparent'}
          _hover={{ bg: showCustom ? 'accent.teal/15' : 'bg.muted' }}
          onClick={(e) => { e.stopPropagation(); setShowCustom(true) }}
          transition="background 0.15s"
        >
          <Text fontSize="xs" fontFamily="mono" fontWeight={showCustom ? '700' : '500'} color={showCustom ? 'accent.teal' : 'fg.default'}>
            Custom…
          </Text>
        </Box>
        {showCustom && (
          <Box px={2} py={1}>
            <input
              aria-label="Custom date format"
              type="text"
              placeholder="e.g. dd/MM/yyyy HH:mm"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onBlur={() => { onChange(customValue || undefined) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { onChange(customValue || undefined) } }}
              onClick={(e) => e.stopPropagation()}
              style={inputStyle}
            />
            <Text fontSize="2xs" color="fg.subtle" mt={0.5}>
              yyyy MM dd HH mm ss MMM MMMM
            </Text>
          </Box>
        )}
      </VStack>
    </Box>
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
    <Box>
      <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
        Format
      </Text>
      <HStack gap={1} flexWrap="wrap">
        {presets.map(({ label, format }) => (
          <Box
            key={label}
            as="button"
            aria-label={`Format ${label}`}
            px={1.5}
            py={0.5}
            borderRadius="sm"
            cursor="pointer"
            fontSize="xs"
            fontFamily="mono"
            fontWeight={(config.format ?? null) === format ? '700' : '500'}
            bg={(config.format ?? null) === format ? 'accent.teal' : 'bg.surface'}
            color={(config.format ?? null) === format ? 'white' : 'fg.default'}
            border="1px solid"
            borderColor={(config.format ?? null) === format ? 'accent.teal' : 'border.muted'}
            _hover={{ bg: (config.format ?? null) === format ? 'accent.teal' : 'bg.muted' }}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setDraft(null); commit(format) }}
            transition="all 0.15s"
          >
            {label}
          </Box>
        ))}
      </HStack>
      <input
        type="text"
        aria-label={`Custom d3 format for ${column}`}
        placeholder={type === 'date' ? 'custom d3, e.g. %b %d' : 'custom d3, e.g. .2~s'}
        value={draft ?? config.format ?? ''}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft != null) { commit(draft); setDraft(null) } }}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit((e.target as HTMLInputElement).value); setDraft(null) } }}
        onClick={(e) => e.stopPropagation()}
        style={{
          fontSize: '12px', fontFamily: 'var(--fonts-mono, monospace)', padding: '4px 8px',
          width: '100%', marginTop: '6px', border: '1px solid var(--colors-border-muted, #333)',
          borderRadius: '4px', background: 'transparent', color: 'inherit', outline: 'none',
        }}
      />
    </Box>
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

  const inputStyle = {
    fontSize: '12px',
    fontFamily: 'var(--fonts-mono, monospace)',
    padding: '4px 8px',
    width: '100%',
    border: '1px solid var(--colors-border-muted, #333)',
    borderRadius: '4px',
    background: 'var(--colors-bg-surface, transparent)',
    color: 'var(--colors-fg-default, inherit)',
    outline: 'none',
  }

  return (
    <VStack align="stretch" gap={2.5} p={2.5} minW="180px">
      {/* Alias */}
      <Box>
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
          Alias
        </Text>
        <input
          type="text"
          aria-label={`Alias for ${column}`}
          placeholder={column}
          value={config.alias || ''}
          onChange={handleAliasChange}
          onClick={(e) => e.stopPropagation()}
          style={inputStyle}
        />
      </Box>

      {/* d3 vocabulary (Viz V2): one format pattern for numbers AND dates */}
      {d3Formats && (type === 'number' || type === 'date') && (
        <D3FormatSection type={type} column={column} config={config} onChange={onChange} />
      )}

      {/* Prefix & Suffix - shown for number type */}
      {!d3Formats && type === 'number' && (
        <HStack gap={2}>
          <Box flex={1}>
            <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
              Prefix
            </Text>
            <input
              type="text"
              placeholder="e.g. $"
              value={config.prefix || ''}
              onChange={handlePrefixChange}
              onClick={(e) => e.stopPropagation()}
              style={inputStyle}
            />
          </Box>
          <Box flex={1}>
            <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
              Suffix
            </Text>
            <input
              type="text"
              placeholder="e.g. %"
              value={config.suffix || ''}
              onChange={handleSuffixChange}
              onClick={(e) => e.stopPropagation()}
              style={inputStyle}
            />
          </Box>
        </HStack>
      )}

      {/* Decimal points - shown for number type */}
      {!d3Formats && type === 'number' && (
        <Box>
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
            Decimal Places
          </Text>
          <HStack gap={1}>
            {DECIMAL_OPTIONS.map(n => (
              <Box
                key={n}
                px={2}
                py={0.5}
                borderRadius="sm"
                cursor="pointer"
                fontSize="xs"
                fontFamily="mono"
                fontWeight={config.decimalPoints === n ? '700' : '500'}
                bg={config.decimalPoints === n ? 'accent.teal' : 'bg.surface'}
                color={config.decimalPoints === n ? 'white' : 'fg.default'}
                border="1px solid"
                borderColor={config.decimalPoints === n ? 'accent.teal' : 'border.muted'}
                _hover={{ bg: config.decimalPoints === n ? 'accent.teal' : 'bg.muted' }}
                onClick={(e) => { e.stopPropagation(); onChange({ ...config, decimalPoints: config.decimalPoints === n ? undefined : n }) }}
                transition="all 0.15s"
                textAlign="center"
                minW="28px"
              >
                {n}
              </Box>
            ))}
          </HStack>
        </Box>
      )}

      {/* Date format - shown for date type */}
      {!d3Formats && type === 'date' && (
        <DateFormatPicker dateFormat={config.dateFormat} onChange={(dateFormat) => onChange({ ...config, dateFormat })} />
      )}
    </VStack>
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
  const Icon = getTypeIcon(type)
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
    <Box position="relative" ref={chipRef} minW={0} maxW="100%" flex="0 1 auto">
      <HStack
        aria-label={`Zone chip ${column}`}
        gap={1.5}
        px={2}
        py={1}
        bg="bg.muted"
        borderRadius="md"
        border="1px solid"
        borderColor={hasFormat ? 'accent.teal' : 'border.muted'}
        minWidth={0}
        maxWidth="100%"
        overflow="hidden"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        cursor="grab"
        _active={{ cursor: 'grabbing' }}
        userSelect="none"
      >
        <Box as={Icon} fontSize="sm" color={color} flexShrink={0} />
        <Text
          fontSize="xs"
          fontFamily="mono"
          color="fg.default"
          whiteSpace="nowrap"
          flex="1"
          minW={0}
          overflow="hidden"
          textOverflow="ellipsis"
        >
          {displayName}
        </Text>
        {extra}
        {onFormatChange && (
          <Box
            as="button"
            aria-label={`Format column ${column}`}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setShowPopover(!showPopover) }}
            ml={0.5}
            color={hasFormat ? 'accent.teal' : 'fg.subtle'}
            _hover={{ color: 'accent.teal' }}
            transition="color 0.2s"
            flexShrink={0}
          >
            <LuSettings2 size={12} />
          </Box>
        )}
        <Box
          as="button"
          aria-label={`Remove ${column}`}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove() }}
          ml={onFormatChange ? 0 : 0.5}
          _hover={{ color: 'accent.danger' }}
          transition="color 0.2s"
          flexShrink={0}
        >
          <LuX size={12} />
        </Box>
      </HStack>

      {/* Format popover */}
      {showPopover && onFormatChange && (
        <Box
          ref={popoverRef}
          position="absolute"
          top="100%"
          left={0}
          mt={1}
          bg="bg.panel"
          border="1px solid"
          borderColor="border.muted"
          borderRadius="md"
          boxShadow="md"
          zIndex={20}
        >
          <FormatPopover
            type={type}
            column={column}
            formatConfig={formatConfig || {}}
            onChange={handleFormatChange}
            d3Formats={d3Formats}
          />
        </Box>
      )}
    </Box>
  )
}
