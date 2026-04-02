'use client'

import { useEffect, useMemo } from 'react'
import { Box, HStack, Input, Text, VStack } from '@chakra-ui/react'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import type { ChartAnnotation } from '@/lib/types'

interface AnnotationEditorProps {
  annotations?: ChartAnnotation[] | null
  onChange: (annotations: ChartAnnotation[]) => void
  enabled: boolean
  xOptions: string[]
  seriesOptions: string[]
}

const MAX_ANNOTATIONS = 8
const selectStyle = {
  width: '100%',
  height: '32px',
  padding: '0 8px',
  borderRadius: '6px',
  border: '1px solid var(--chakra-colors-border-muted)',
  background: 'var(--chakra-colors-bg-canvas)',
  color: 'var(--chakra-colors-fg-default)',
  fontFamily: 'var(--fonts-mono, monospace)',
  fontSize: '12px',
}

export const AnnotationEditor = ({ annotations, onChange, enabled, xOptions, seriesOptions }: AnnotationEditorProps) => {
  const items = annotations ?? []
  const defaultX = xOptions[0] ?? ''
  const defaultSeries = seriesOptions[0] ?? ''

  const normalizedItems = useMemo(() => (
    items.map((item) => ({
      ...item,
      x: item.x ?? defaultX,
      series: item.series ?? defaultSeries,
    }))
  ), [items, defaultSeries, defaultX])

  useEffect(() => {
    if (!enabled || items.length === 0) return
    const needsNormalization = items.some(item => item.x == null || item.series == null)
    if (needsNormalization) {
      onChange(normalizedItems)
    }
  }, [enabled, items, normalizedItems, onChange])

  const updateItem = (index: number, patch: Partial<ChartAnnotation>) => {
    const next = normalizedItems.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    onChange(next)
  }

  const addItem = () => {
    if (items.length >= MAX_ANNOTATIONS) return
    onChange([...items, { x: xOptions[0] ?? '', series: seriesOptions[0] ?? '', text: '' }])
  }

  const removeItem = (index: number) => {
    onChange(items.filter((_, itemIndex) => itemIndex !== index))
  }

  return (
    <VStack
      align="stretch"
      gap={3}
      p={3}
      bg="bg.surface"
      borderRadius="md"
      border="2px dashed"
      borderColor="border.muted"
      minW={0}
    >
      <HStack justify="space-between" align="center">
        <Box>
          <Text fontSize="xs" color="fg.muted">
            Add up to {MAX_ANNOTATIONS} labels with `x`, `series`, and text.
          </Text>
        </Box>
        <button
          type="button"
          onClick={addItem}
          disabled={!enabled || items.length >= MAX_ANNOTATIONS}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 8px',
            borderRadius: '6px',
            border: '1px solid var(--chakra-colors-border-muted)',
            background: 'var(--chakra-colors-bg-surface)',
            color: 'var(--chakra-colors-fg-subtle)',
            opacity: !enabled || items.length >= MAX_ANNOTATIONS ? 0.5 : 1,
            cursor: !enabled || items.length >= MAX_ANNOTATIONS ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <LuPlus size={12} />
          <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em">
            Add
          </Text>
        </button>
      </HStack>

      {!enabled && (
        <Text fontSize="xs" color="fg.muted">
          Available for line, bar, area, and scatter charts with exactly one X-axis field.
        </Text>
      )}

      {enabled && items.length === 0 && (
        <Text fontSize="xs" color="fg.muted">
          No annotations yet.
        </Text>
      )}

      {enabled && items.length > 0 && (
        <VStack align="stretch" gap={2} maxH="200px" overflowY="auto" pr={1}>
          {normalizedItems.map((annotation, index) => (
            <Box key={index} p={2} border="1px solid" borderColor="border.muted" borderRadius="md" bg="bg.canvas">
              <HStack align="end" gap={2} minW={0}>
                <Box width="160px" flexShrink={0}>
                  <Text fontSize="2xs" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
                    X Value
                  </Text>
                  <select
                    value={String(annotation.x ?? '')}
                    onChange={(e) => updateItem(index, { x: e.target.value })}
                    style={selectStyle}
                  >
                    {xOptions.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Box>
                <Box width="180px" flexShrink={0}>
                  <Text fontSize="2xs" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
                    Series
                  </Text>
                  <select
                    value={annotation.series ?? ''}
                    onChange={(e) => updateItem(index, { series: e.target.value })}
                    style={selectStyle}
                  >
                    {seriesOptions.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Box>
                <Box flex="1" minW={0}>
                  <Text fontSize="2xs" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
                    Text
                  </Text>
                  <Input
                    size="sm"
                    value={annotation.text}
                    onChange={(e) => updateItem(index, { text: e.target.value })}
                    placeholder="Short note"
                    fontFamily="mono"
                  />
                </Box>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  aria-label="Remove annotation"
                  style={{
                    marginBottom: '4px',
                    color: 'var(--chakra-colors-fg-subtle)',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                >
                  <LuTrash2 size={14} />
                </button>
              </HStack>
            </Box>
          ))}
        </VStack>
      )}
    </VStack>
  )
}
