'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { LuHash, LuCalendar, LuType, LuX, LuSettings2 } from 'react-icons/lu'
import { getColumnType } from '@/lib/database/duckdb'
import { DATE_FORMAT_OPTIONS } from '@/lib/chart/chart-utils'
import type { ColumnFormatConfig } from '@/lib/types'

// Shared types
export type ColumnType = 'date' | 'number' | 'text'

export const getTypeIcon = (type: ColumnType) => {
  switch (type) {
    case 'number': return LuHash
    case 'date': return LuCalendar
    case 'text': return LuType
  }
}

export const getTypeColor = (type: ColumnType) => {
  switch (type) {
    case 'number': return '#2980b9' // Primary blue
    case 'date': return '#9b59b6'   // Purple
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
  useEffect(() => {
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
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  onMobileSelect?: () => void
}

export const ColumnChip = ({
  column, type, isAssigned, isDragging, isMobileSelected, isTouchDevice,
  onDragStart, onDragEnd, onMobileSelect,
}: ColumnChipProps) => {
  const Icon = getTypeIcon(type)
  const color = getTypeColor(type)

  return (
    <HStack
      gap={1.5}
      px={2}
      py={1}
      bg={isMobileSelected ? 'accent.teal' : isAssigned ? 'bg.muted' : 'transparent'}
      borderRadius="md"
      border="1px solid"
      borderColor={isMobileSelected ? 'accent.teal' : isAssigned ? 'accent.teal' : 'border.muted'}
      cursor={isTouchDevice ? 'pointer' : 'grab'}
      opacity={isDragging ? 0.4 : isAssigned ? 1 : 0.7}
      _hover={{ bg: isMobileSelected ? 'accent.teal' : 'bg.muted', borderColor: isAssigned ? 'accent.teal' : 'border.default' }}
      _active={{ cursor: isTouchDevice ? 'pointer' : 'grabbing' }}
      draggable={!isTouchDevice}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => isTouchDevice && onMobileSelect?.()}
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
}

export const DropZone = ({ label, onDrop, isTouchDevice, children }: DropZoneProps) => {
  const [isDragOver, setIsDragOver] = useState(false)

  return (
    <VStack
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
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragOver(false); onDrop() }}
      onClick={() => isTouchDevice && onDrop()}
      cursor={isTouchDevice ? 'pointer' : 'default'}
      transition="border-color 0.15s, background 0.15s"
    >
      <Text
        fontSize="2xs"
        fontWeight="700"
        color="fg.subtle"
        textTransform="uppercase"
        letterSpacing="0.05em"
        position="absolute"
        top={-2.5}
        bg="bg.muted"
        px={1.5}
        borderRadius="sm"
        border="1px dashed"
        borderColor={isDragOver ? 'accent.teal' : 'border.muted'}
      >
        {label}
      </Text>
      {children}
    </VStack>
  )
}

// Format popover content (shown on ZoneChip click)
const DECIMAL_OPTIONS = [0, 1, 2, 3, 4] as const

interface FormatPopoverProps {
  type: ColumnType
  column: string
  formatConfig: ColumnFormatConfig
  onChange: (config: ColumnFormatConfig) => void
}

const FormatPopover = ({ type, column, formatConfig, onChange }: FormatPopoverProps) => {
  const config = formatConfig

  const handleAliasChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...config, alias: e.target.value || undefined })
  }, [config, onChange])

  return (
    <VStack align="stretch" gap={2.5} p={2.5} minW="180px">
      {/* Alias - shown for text type */}
      {type === 'text' && (
        <Box>
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
            Alias
          </Text>
          <input
            type="text"
            placeholder={column}
            value={config.alias || ''}
            onChange={handleAliasChange}
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: '12px',
              fontFamily: 'var(--fonts-mono, monospace)',
              padding: '4px 8px',
              width: '100%',
              border: '1px solid var(--colors-border-muted, #333)',
              borderRadius: '4px',
              background: 'var(--colors-bg-surface, transparent)',
              color: 'var(--colors-fg-default, inherit)',
              outline: 'none',
            }}
          />
        </Box>
      )}

      {/* Decimal points - shown for number type */}
      {type === 'number' && (
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
      {type === 'date' && (
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
                bg={config.dateFormat === fmt.value ? 'accent.teal/15' : 'transparent'}
                _hover={{ bg: config.dateFormat === fmt.value ? 'accent.teal/15' : 'bg.muted' }}
                onClick={(e) => { e.stopPropagation(); onChange({ ...config, dateFormat: config.dateFormat === fmt.value ? undefined : fmt.value }) }}
                transition="background 0.15s"
              >
                <Text fontSize="xs" fontFamily="mono" fontWeight={config.dateFormat === fmt.value ? '700' : '500'} color={config.dateFormat === fmt.value ? 'accent.teal' : 'fg.default'}>
                  {fmt.label}
                </Text>
              </Box>
            ))}
          </VStack>
        </Box>
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
}

export const ZoneChip = ({ column, type, onRemove, extra, formatConfig, onFormatChange }: ZoneChipProps) => {
  const Icon = getTypeIcon(type)
  const color = getTypeColor(type)
  const [showPopover, setShowPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLDivElement>(null)

  const displayName = formatConfig?.alias || column
  const hasFormat = formatConfig && (formatConfig.alias || formatConfig.decimalPoints !== undefined || formatConfig.dateFormat)

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
    <Box position="relative" ref={chipRef}>
      <HStack
        gap={1.5}
        px={2}
        py={1}
        bg="bg.muted"
        borderRadius="md"
        border="1px solid"
        borderColor={hasFormat ? 'accent.teal' : 'border.muted'}
        minWidth={0}
      >
        <Box as={Icon} fontSize="sm" color={color} flexShrink={0} />
        <Text fontSize="xs" fontFamily="mono" color="fg.default" whiteSpace="nowrap">
          {displayName}
        </Text>
        {extra}
        {onFormatChange && (
          <Box
            as="button"
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
          />
        </Box>
      )}
    </Box>
  )
}
