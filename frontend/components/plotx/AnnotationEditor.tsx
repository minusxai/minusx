'use client'

import { useEffect, useMemo } from 'react'
import { Box, HStack, Text, VStack } from '@chakra-ui/react'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import type { ChartAnnotation } from '@/lib/types'
// Pure matcher (formerly lib/chart/chart-annotations, deleted with the ECharts stack):
// exact match first, then date-prefix matching (date-only vs full ISO).
const findMatchingXIndex = (xAxisData: string[], annotationX: string | number): number => {
  const needle = String(annotationX)
  const exactIndex = xAxisData.findIndex(item => String(item) === needle)
  if (exactIndex !== -1) return exactIndex
  return xAxisData.findIndex(item => {
    const hay = String(item)
    return hay.startsWith(needle) || needle.startsWith(hay)
  })
}

interface AnnotationEditorProps {
  annotations?: ChartAnnotation[] | null
  onChange: (annotations: ChartAnnotation[]) => void
  enabled: boolean
  xOptions: string[]
  seriesOptions: string[]
}

const MAX_ANNOTATIONS = 8

const inputStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'var(--fonts-mono, monospace)',
  padding: '4px 8px',
  width: '100%',
  border: '1px solid var(--chakra-colors-border-muted)',
  borderRadius: '4px',
  background: 'var(--chakra-colors-bg-canvas)',
  color: 'var(--chakra-colors-fg-default)',
  outline: 'none',
  height: '28px',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
}

/** Show a short readable label for date-like x values */
const formatXLabel = (value: string): string => {
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export const AnnotationEditor = ({ annotations, onChange, enabled, xOptions, seriesOptions }: AnnotationEditorProps) => {
  const items = annotations ?? []
  const defaultX = xOptions[0] ?? ''

  const normalizedItems = useMemo(() => (
    items.map((item) => {
      if (item.x == null) return { ...item, x: defaultX }
      const exactMatch = xOptions.includes(String(item.x))
      if (!exactMatch) {
        const fuzzyIndex = findMatchingXIndex(xOptions, item.x)
        if (fuzzyIndex !== -1) return { ...item, x: xOptions[fuzzyIndex] }
      }
      return item
    })
  ), [items, defaultX, xOptions])

  useEffect(() => {
    if (!enabled || items.length === 0) return
    const needsNormalization = items.some((item, i) => item !== normalizedItems[i])
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
    onChange([...items, { x: xOptions[0] ?? '', series: null, text: '' }])
  }

  const removeItem = (index: number) => {
    onChange(items.filter((_, itemIndex) => itemIndex !== index))
  }

  if (!enabled) {
    return (
      <Text fontSize="xs" color="fg.muted">
        Available for line, bar, area, and scatter charts with exactly one X-axis field.
      </Text>
    )
  }

  return (
    <VStack align="stretch" gap={2.5} minW={0}>
      {items.length === 0 && (
        <HStack justify="space-between" align="center">
          <Text fontSize="xs" color="fg.muted">No annotations yet.</Text>
          <button
            type="button"
            onClick={addItem}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '4px',
              border: '1px solid var(--chakra-colors-border-muted)',
              background: 'transparent',
              color: 'var(--chakra-colors-fg-subtle)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <LuPlus size={10} />
            <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em">
              Add
            </Text>
          </button>
        </HStack>
      )}

      {items.length > 0 && (
        <VStack align="stretch" gap={2} maxH="260px" overflowY="auto">
          {normalizedItems.map((annotation, index) => (
            <VStack key={index} align="stretch" gap={1.5} p={2} border="1px solid" borderColor="border.muted" borderRadius="md">
              <HStack gap={2} minW={0}>
                <Box flex={1} minW={0}>
                  <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={0.5}>
                    X Value
                  </Text>
                  <select
                    value={String(annotation.x ?? '')}
                    onChange={(e) => updateItem(index, { x: e.target.value })}
                    style={selectStyle}
                  >
                    {xOptions.map(option => (
                      <option key={option} value={option}>
                        {formatXLabel(option)}
                      </option>
                    ))}
                  </select>
                </Box>
                <Box flex={1} minW={0}>
                  <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={0.5}>
                    Series
                  </Text>
                  <select
                    value={annotation.series ?? ''}
                    onChange={(e) => updateItem(index, { series: e.target.value || null })}
                    style={selectStyle}
                  >
                    <option value="">None</option>
                    {seriesOptions.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Box>
              </HStack>
              <HStack gap={2} minW={0}>
                <Box flex={1} minW={0}>
                  <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={0.5}>
                    Label
                  </Text>
                  <input
                    type="text"
                    value={annotation.text}
                    onChange={(e) => updateItem(index, { text: e.target.value })}
                    placeholder="Short note"
                    style={inputStyle}
                  />
                </Box>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  aria-label="Remove annotation"
                  style={{
                    marginTop: '16px',
                    color: 'var(--chakra-colors-fg-subtle)',
                    background: 'transparent',
                    border: 'none',
                    padding: '4px',
                    flexShrink: 0,
                    cursor: 'pointer',
                    opacity: 0.6,
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6' }}
                >
                  <LuTrash2 size={13} />
                </button>
              </HStack>
            </VStack>
          ))}

          {items.length < MAX_ANNOTATIONS && (
            <button
              type="button"
              onClick={addItem}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid var(--chakra-colors-border-muted)',
                background: 'transparent',
                color: 'var(--chakra-colors-fg-subtle)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                width: '100%',
              }}
            >
              <LuPlus size={10} />
              <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em">
                Add annotation
              </Text>
            </button>
          )}
        </VStack>
      )}
    </VStack>
  )
}
