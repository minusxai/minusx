'use client'

import { useEffect, useMemo } from 'react'
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

// Tiny section label (Chakra 2xs/700/0.05em equivalent)
const SECTION_LABEL = 'text-[10px] font-bold uppercase tracking-wider text-muted-foreground'

const inputStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'var(--font-jetbrains-mono, monospace)',
  padding: '4px 8px',
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  background: 'var(--background)',
  color: 'var(--foreground)',
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
      <p className="text-xs text-muted-foreground">
        Available for line, bar, area, and scatter charts with exactly one X-axis field.
      </p>
    )
  }

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2.5">
      {items.length === 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">No annotations yet.</p>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-transparent px-2 py-[3px] text-muted-foreground transition-all duration-150"
          >
            <LuPlus size={10} />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Add
            </span>
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex max-h-[260px] flex-col items-stretch gap-2 overflow-y-auto">
          {normalizedItems.map((annotation, index) => (
            <div key={index} className="flex flex-col items-stretch gap-1.5 rounded-md border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className={`${SECTION_LABEL} mb-0.5`}>
                    X Value
                  </div>
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
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`${SECTION_LABEL} mb-0.5`}>
                    Series
                  </div>
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
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className={`${SECTION_LABEL} mb-0.5`}>
                    Label
                  </div>
                  <input
                    type="text"
                    value={annotation.text}
                    onChange={(e) => updateItem(index, { text: e.target.value })}
                    placeholder="Short note"
                    style={inputStyle}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  aria-label="Remove annotation"
                  className="mt-4 shrink-0 cursor-pointer border-none bg-transparent p-1 text-muted-foreground opacity-60 transition-opacity duration-150 hover:opacity-100"
                >
                  <LuTrash2 size={13} />
                </button>
              </div>
            </div>
          ))}

          {items.length < MAX_ANNOTATIONS && (
            <button
              type="button"
              onClick={addItem}
              className="inline-flex w-full cursor-pointer items-center justify-center gap-1 rounded border border-border bg-transparent px-2 py-1 text-muted-foreground transition-all duration-150"
            >
              <LuPlus size={10} />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                Add annotation
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
