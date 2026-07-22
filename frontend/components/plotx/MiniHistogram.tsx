/**
 * Column-stat histogram spark (table header). Plain hand-rendered SVG — no chart engine
 * (Renderer_v2 Phase 2 removed ECharts): N bars is a handful of <rect>s, and the native
 * <title> tooltip carries the bin range + count.
 */
import { Box, HStack, Text } from '@chakra-ui/react'

interface MiniHistogramProps {
  data: Array<{ bin: number; binMin: number; binMax: number; count: number }>
  color?: string
  height?: number
  isDate?: boolean
  isFirstColumn?: boolean  // Reserved for future use
  isLastColumn?: boolean   // Reserved for future use
}

const CHART_H = 40
const GAP = 1

const formatEdge = (value: number, isDate: boolean): string => {
  if (isDate) {
    const date = new Date(value * 1000)
    const month = date.toLocaleDateString('en-US', { month: 'short' })
    const year = date.toLocaleDateString('en-US', { year: '2-digit' })
    return `${month} ${year}`
  }
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toFixed(0)
}

const binTitle = (d: { binMin: number; binMax: number; count: number }, isDate: boolean): string => {
  if (isDate) {
    const fmt = (v: number) => new Date(v * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${fmt(d.binMin)} - ${fmt(d.binMax)}\nCount: ${d.count.toLocaleString()}`
  }
  return `Range: ${d.binMin.toLocaleString()} - ${d.binMax.toLocaleString()}\nCount: ${d.count.toLocaleString()}`
}

export const MiniHistogram = ({
  data,
  color = '#2980b9',
  isDate = false,
}: MiniHistogramProps) => {
  if (!data || data.length === 0) return null

  const maxCount = Math.max(...data.map(d => d.count), 1)
  const barW = 100 / data.length

  return (
    <Box position="relative">
      <svg
        aria-label={`Histogram of ${data.length} bins`}
        width="100%"
        height={CHART_H}
        viewBox={`0 0 100 ${CHART_H}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {data.map((d, i) => {
          const h = Math.max((d.count / maxCount) * CHART_H, d.count > 0 ? 1 : 0)
          return (
            <rect
              key={i}
              x={i * barW + GAP / 2}
              y={CHART_H - h}
              width={Math.max(barW - GAP, 0.5)}
              height={h}
              fill={color}
            >
              <title>{binTitle(d, isDate)}</title>
            </rect>
          )
        })}
      </svg>
      <HStack justify="space-between" fontSize="3xs" color="fg.subtle" fontFamily="mono" mt={0.5}>
        <Text>{formatEdge(data[0]?.binMin, isDate)}</Text>
        <Text>{formatEdge(data[data.length - 1]?.binMax, isDate)}</Text>
      </HStack>
    </Box>
  )
}
