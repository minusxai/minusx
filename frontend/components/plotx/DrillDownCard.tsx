'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Box, HStack, VStack, Text, IconButton, Input, Button } from '@chakra-ui/react'
import { LuSend, LuTable, LuClipboard, LuCheck } from 'react-icons/lu'
import { useAppDispatch } from '@/store/hooks'
import { setSidebarPendingMessage, setRightSidebarCollapsed, setActiveSidebarSection } from '@/store/uiSlice'
import { useConfigs } from '@/lib/hooks/useConfigs'

export interface DrillDownState {
  filters: Record<string, string>
  filterTypes?: Record<string, string>
  yColumn: string
  position: { x: number; y: number }
}

interface DrillDownCardProps {
  drillDown: DrillDownState | null
  onClose: () => void
  sql?: string
  databaseName?: string
}

export const DrillDownCard = ({ drillDown, onClose, sql, databaseName }: DrillDownCardProps) => {
  const dispatch = useAppDispatch()
  const { config: appConfig } = useConfigs()
  const agentName = appConfig.branding.agentName

  const cardRef = useRef<HTMLDivElement>(null)
  const [askInput, setAskInput] = useState('')
  const [askFocused, setAskFocused] = useState(false)
  const [copiedCol, setCopiedCol] = useState<string | null>(null)

  // Reset state when drill-down changes — intentional setState in effect
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAskInput('')
    setAskFocused(false)
  }, [drillDown])

  // Close on click outside or Escape
  useEffect(() => {
    if (!drillDown) return
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [drillDown, onClose])

  // Build CTE SQL and open in new tab
  const handleSeeRecords = useCallback(() => {
    if (!drillDown || !sql) return
    const whereClauses = Object.entries(drillDown.filters).map(([col, val]) => {
      const colType = drillDown.filterTypes?.[col]
      if (colType === 'number') {
        return `"${col}" = ${String(val)}`
      }
      const escapedVal = String(val).replace(/'/g, "''")
      return `"${col}" = '${escapedVal}'`
    })
    const whereClause = whereClauses.length > 0 ? `\nWHERE ${whereClauses.join('\n  AND ')}` : ''
    const cteSql = `WITH base AS (\n${sql}\n)\nSELECT * FROM base${whereClause}`
    const params = new URLSearchParams()
    if (databaseName) params.set('databaseName', databaseName)
    const utf8Bytes = new TextEncoder().encode(cteSql)
    const binaryStr = Array.from(utf8Bytes, b => String.fromCharCode(b)).join('')
    params.set('queryB64', btoa(binaryStr))
    window.open(`/new/question?${params.toString()}`, '_blank')
    onClose()
  }, [drillDown, sql, databaseName, onClose])

  // Ask agent about the drill-down selection
  const handleAskAgent = useCallback(() => {
    if (!drillDown) return
    const filterDesc = Object.entries(drillDown.filters)
      .map(([col, val]) => `${col} = ${val}`)
      .join(', ')
    const context = filterDesc ? `Context: data where ${filterDesc}.` : `Context: total ${drillDown.yColumn} value.`
    const userQuestion = askInput.trim() || 'What stands out about this data?'
    const message = `${userQuestion}\n${context}`
    dispatch(setSidebarPendingMessage(message))
    dispatch(setRightSidebarCollapsed(false))
    dispatch(setActiveSidebarSection('chat'))
    onClose()
  }, [drillDown, dispatch, askInput, onClose])

  if (!drillDown) return null

  // Compute card position: clamp to stay within viewport
  const cardW = askFocused ? 440 : 320
  const cardH = 320
  const vw = window.innerWidth
  const vh = window.innerHeight

  const spaceRight = vw - drillDown.position.x
  const anchorRight = spaceRight < cardW + 8
  const x = anchorRight
    ? Math.max(8, drillDown.position.x - cardW)
    : Math.min(drillDown.position.x, vw - cardW - 8)
  const spaceBelow = vh - drillDown.position.y
  const anchorAbove = spaceBelow < cardH + 8
  const y = anchorAbove
    ? Math.max(8, drillDown.position.y - cardH)
    : Math.min(drillDown.position.y, vh - cardH - 8)

  const filterEntries = Object.entries(drillDown.filters)

  return (
    <Box
      ref={cardRef}
      position="fixed"
      left={`${x}px`}
      top={`${y}px`}
      zIndex={1000}
      bg="bg.surface"
      border="1px solid"
      borderColor="border.default"
      borderRadius="lg"
      boxShadow="lg"
      p={3}
      width={askFocused ? '440px' : '320px'}
      transition="width 0.2s ease, left 0.2s ease"
    >
      <VStack align="stretch" gap={1.5}>
        {filterEntries.map(([col, val]) => (
          <VStack key={col} align="start" gap={1}>
            <HStack gap={1} w="100%">
              <Text fontWeight="600" color="fg.muted" fontSize="xs" flex={1}>{col}</Text>
              <IconButton
                aria-label="Copy value"
                size="2xs"
                variant="ghost"
                color={copiedCol === col ? 'accent.teal' : 'fg.muted'}
                onClick={() => {
                  navigator.clipboard.writeText(String(val))
                  setCopiedCol(col)
                  setTimeout(() => setCopiedCol(null), 1500)
                }}
              >
                {copiedCol === col ? <>Copied <LuCheck /></> : <LuClipboard />}
              </IconButton>
            </HStack>
            <Box
              w="100%"
              maxH="120px"
              overflowY="auto"
              bg="bg.muted"
              borderRadius="md"
              px={2}
              py={1.5}
              border="1px solid"
              borderColor="border.muted"
            >
              <Text fontSize="xs" fontFamily="mono" color="fg.default" whiteSpace="pre-wrap" wordBreak="break-all">
                {String(val)}
              </Text>
            </Box>
          </VStack>
        ))}
        {filterEntries.length === 0 && (
          <Text fontSize="xs" color="fg.muted">Total aggregation</Text>
        )}
        <Box borderTop="1px solid" borderColor="border.muted" my={1} />
        {sql && (
          <Button
            size="xs"
            variant="solid"
            bg="accent.teal"
            color="white"
            width="full"
            onClick={handleSeeRecords}
          >
            <LuTable />
            See Similar Records
          </Button>
        )}
        <HStack gap={1}>
          <Input
            size="xs"
            fontSize="xs"
            placeholder={`Ask ${agentName} about this datapoint...`}
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            onFocus={() => setAskFocused(true)}
            onBlur={() => setAskFocused(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAskAgent() }}
            flex={1}
            fontFamily="mono"
            borderColor={askFocused ? 'accent.teal' : 'border.default'}
            outline={"none"}
          />
          <IconButton
            aria-label={`Ask ${agentName}`}
            size="xs"
            variant="solid"
            colorPalette="teal"
            onClick={handleAskAgent}
          >
            <LuSend />
          </IconButton>
        </HStack>
      </VStack>
    </Box>
  )
}
