'use client'

import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { Box, HStack, Text, VStack } from '@chakra-ui/react'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
import { useAppSelector } from '@/store/hooks'
import { VIZ_CAPABILITIES } from '@/lib/chart/viz-capabilities'
import type { VisualizationStyleConfig, VisualizationType } from '@/lib/types'

interface VizOverridesPanelProps {
  chartType: VisualizationType
  styleConfig?: VisualizationStyleConfig
  onChange: (config: VisualizationStyleConfig) => void
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Human-visible editor for the styleConfig escape hatches — `echartsOverrides`
 * (raw ECharts option JSON, canvas types) and `cssOverrides` (raw CSS scoped to the
 * viz root, DOM/Leaflet types). The agent writes these keys freely; this panel is
 * what keeps them from being invisible state a human can never inspect, tweak, or
 * clear. Which hatch applies comes from the capability registry, so the UI and the
 * agent's docs can never disagree. Patches only its own key; every other
 * styleConfig field passes through untouched.
 */
export const VizOverridesPanel = ({ chartType, styleConfig, onChange }: VizOverridesPanelProps) => {
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Monaco keeps its own buffer (defaultValue) so typing doesn't reset the cursor;
  // bumping the epoch remounts it when we change the value from outside (Clear).
  const [editorEpoch, setEditorEpoch] = useState(0)

  const cap = VIZ_CAPABILITIES[chartType]
  const hatch = cap?.levers.echartsOverrides ? 'echartsOverrides' : cap?.levers.cssOverrides ? 'cssOverrides' : null
  if (!hatch) return null
  const isJson = hatch === 'echartsOverrides'

  const currentText = isJson
    ? (styleConfig?.echartsOverrides && Object.keys(styleConfig.echartsOverrides).length > 0
        ? JSON.stringify(styleConfig.echartsOverrides, null, 2)
        : '')
    : (styleConfig?.cssOverrides ?? '')
  const hasOverrides = currentText.trim().length > 0

  const emit = (value: Record<string, unknown> | string | null) => {
    const next: VisualizationStyleConfig = { ...(styleConfig ?? {}) }
    if (value == null) delete next[hatch]
    else next[hatch] = value as never
    onChange(next)
  }

  const handleEditorChange = (text: string | undefined) => {
    const raw = text ?? ''
    if (raw.trim() === '') {
      setError(null)
      emit(null)
      return
    }
    if (!isJson) {
      setError(null)
      emit(raw)
      return
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isPlainObject(parsed)) {
        setError('Overrides must be a JSON object (an ECharts option fragment).')
        return
      }
      setError(null)
      emit(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  const handleClear = () => {
    setError(null)
    setEditorEpoch((n) => n + 1)
    emit(null)
  }

  return (
    <VStack align="stretch" gap={1} width="100%">
      <HStack
        as="button"
        aria-label="Toggle advanced overrides"
        gap={1}
        px={0}
        py={0.5}
        cursor="pointer"
        color="fg.subtle"
        _hover={{ color: 'fg.default' }}
        transition="all 0.15s"
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
        <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em">
          Advanced overrides
        </Text>
        {hasOverrides && (
          <Box
            aria-label="Overrides active"
            px={1.5}
            borderRadius="sm"
            bg="accent.teal/15"
            color="accent.teal"
            fontSize="2xs"
            fontWeight="700"
          >
            set
          </Box>
        )}
      </HStack>

      {open && (
        <VStack align="stretch" gap={1.5}>
          <Text fontSize="2xs" color="fg.subtle">
            {isJson
              ? 'Raw ECharts option fragment, deep-merged into the final chart option (arrays replace wholesale). Usually written by the agent — edit with care.'
              : 'Raw CSS scoped to this visualization. Usually written by the agent — edit with care.'}
          </Text>
          {!isJson && cap.cssHooks.length > 0 && (
            <Box aria-label="Style override hooks" fontSize="2xs" fontFamily="mono" color="fg.subtle">
              {cap.cssHooks.map((hook) => (
                <Text key={hook}>{hook}</Text>
              ))}
            </Box>
          )}
          {error && (
            <Box
              aria-label="Style overrides error"
              p={1.5}
              bg="accent.danger/10"
              color="accent.danger"
              borderRadius="sm"
              fontSize="2xs"
            >
              {error}
            </Box>
          )}
          <Box border="1px solid" borderColor="border.muted" borderRadius="md" overflow="hidden">
            <Editor
              key={`${chartType}-${editorEpoch}`}
              height="160px"
              defaultLanguage={isJson ? 'json' : 'css'}
              defaultValue={currentText}
              onChange={handleEditorChange}
              theme={colorMode === 'dark' ? 'vs-dark' : 'vs-light'}
              options={{
                ariaLabel: 'Style overrides editor',
                minimap: { enabled: false },
                lineNumbers: 'off',
                folding: false,
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                fontSize: 11,
                fontFamily: 'var(--font-jetbrains-mono)',
                automaticLayout: true,
                tabSize: 2,
                padding: { top: 8, bottom: 8 },
              }}
            />
          </Box>
          {hasOverrides && (
            <Box
              as="button"
              aria-label="Clear style overrides"
              alignSelf="flex-start"
              px={2}
              py={0.5}
              borderRadius="sm"
              cursor="pointer"
              fontSize="xs"
              fontFamily="mono"
              bg="bg.surface"
              color="fg.default"
              border="1px solid"
              borderColor="border.muted"
              _hover={{ bg: 'bg.muted' }}
              transition="all 0.15s"
              onClick={handleClear}
            >
              clear
            </Box>
          )}
        </VStack>
      )}
    </VStack>
  )
}
