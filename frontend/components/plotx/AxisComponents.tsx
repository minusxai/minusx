'use client'

import { useState, useEffect } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { LuHash, LuCalendar, LuType, LuX } from 'react-icons/lu'
import { getColumnType } from '@/lib/database/duckdb'

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

// Chip inside a drop zone (removable)
interface ZoneChipProps {
  column: string
  type: ColumnType
  onRemove: () => void
  /** Extra content to render after the column name (e.g., aggregation selector) */
  extra?: React.ReactNode
}

export const ZoneChip = ({ column, type, onRemove, extra }: ZoneChipProps) => {
  const Icon = getTypeIcon(type)
  const color = getTypeColor(type)

  return (
    <HStack
      gap={1.5}
      px={2}
      py={1}
      bg="bg.muted"
      borderRadius="md"
      border="1px solid"
      borderColor="border.muted"
      minWidth={0}
      position="relative"
    >
      <Box as={Icon} fontSize="sm" color={color} flexShrink={0} />
      <Text fontSize="xs" fontFamily="mono" color="fg.default" whiteSpace="nowrap">
        {column}
      </Text>
      {extra}
      <Box
        as="button"
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove() }}
        ml={0.5}
        _hover={{ color: 'accent.danger' }}
        transition="color 0.2s"
        flexShrink={0}
      >
        <LuX size={12} />
      </Box>
    </HStack>
  )
}
