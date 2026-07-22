'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { LuSend, LuTable, LuClipboard, LuCheck } from 'react-icons/lu'
import { useAppDispatch } from '@/store/hooks'
import { setSidebarPendingMessage, setRightSidebarCollapsed, setActiveSidebarSection } from '@/store/uiSlice'
import { useConfigs } from '@/lib/hooks/useConfigs'
import { buildDrillDownSql } from './drilldown-utils'

// Accent constants (the app palette — same values the converted pivot uses).
const TEAL = '#16a085'

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
    const cteSql = buildDrillDownSql(sql, drillDown.filters, drillDown.filterTypes ?? {})
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

  // Portaled to body (floating card at click coordinates). data-mx-theme-host is
  // REQUIRED: shadcn token classes don't resolve outside the app-shell theme host,
  // and `.dark` on <html> makes the dark token block match here too.
  return createPortal(
    <div
      ref={cardRef}
      data-mx-theme-host=""
      className="fixed z-[1000] rounded-lg border border-border bg-popover p-3 shadow-lg transition-[width,left] duration-200 ease-in-out"
      style={{ left: `${x}px`, top: `${y}px`, width: askFocused ? '440px' : '320px' }}
    >
      <div className="flex flex-col items-stretch gap-1.5">
        {filterEntries.map(([col, val]) => (
          <div key={col} className="flex flex-col items-start gap-1">
            <div className="flex w-full items-center gap-1">
              <span className="flex-1 text-xs font-semibold text-muted-foreground">{col}</span>
              <button
                aria-label="Copy value"
                className={`inline-flex h-5 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md px-1 text-xs font-medium transition-all hover:bg-accent ${
                  copiedCol === col ? 'text-[#16a085]' : 'text-muted-foreground'
                }`}
                onClick={() => {
                  navigator.clipboard.writeText(String(val))
                  setCopiedCol(col)
                  setTimeout(() => setCopiedCol(null), 1500)
                }}
              >
                {copiedCol === col ? <>Copied <LuCheck /></> : <LuClipboard />}
              </button>
            </div>
            <div className="max-h-[120px] w-full overflow-y-auto rounded-md border border-border bg-muted px-2 py-1.5">
              <span className="font-mono text-xs whitespace-pre-wrap break-all text-foreground">
                {String(val)}
              </span>
            </div>
          </div>
        ))}
        {filterEntries.length === 0 && (
          <span className="text-xs text-muted-foreground">Total aggregation</span>
        )}
        <div className="my-1 border-t border-border" />
        {sql && (
          <button
            className="inline-flex h-6 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-white transition-all hover:opacity-90"
            style={{ background: TEAL }}
            onClick={handleSeeRecords}
          >
            <LuTable />
            See Similar Records
          </button>
        )}
        <div className="flex items-center gap-1">
          <input
            placeholder={`Ask ${agentName} about this datapoint...`}
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            onFocus={() => setAskFocused(true)}
            onBlur={() => setAskFocused(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAskAgent() }}
            className="h-6 min-w-0 flex-1 rounded-sm border bg-transparent px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
            style={{ borderColor: askFocused ? TEAL : 'var(--border)' }}
          />
          <button
            aria-label={`Ask ${agentName}`}
            className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-white transition-all hover:opacity-90"
            style={{ background: TEAL }}
            onClick={handleAskAgent}
          >
            <LuSend />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
