/**
 * Column-stat top-values spark (table header). Plain hand-rendered SVG — no chart engine
 * (Renderer_v2 Phase 2 removed ECharts): a row per value with a truncated label, a
 * proportional bar, and a native <title> tooltip.
 */
import { Box, Text } from '@chakra-ui/react'

interface MiniBarChartProps {
  data: Array<{ value: string; count: number }>
  totalUnique: number
  color?: string
  height?: number
}

const ROW_H = 14
const LABEL_W = 62

export const MiniBarChart = ({
  data,
  totalUnique,
  color = '#f39c12',
}: MiniBarChartProps) => {
  if (!data || data.length === 0) return null

  const maxCount = Math.max(...data.map(d => d.count), 1)
  const remaining = totalUnique - data.length
  const chartH = data.length * ROW_H

  return (
    <Box>
      <svg
        aria-label="Top values bar chart"
        width="100%"
        height={chartH}
        viewBox={`0 0 160 ${chartH}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {data.map((d, i) => {
          const w = Math.max((d.count / maxCount) * (160 - LABEL_W - 2), 1)
          return (
            <g key={i}>
              <text
                x={LABEL_W - 4}
                y={i * ROW_H + ROW_H / 2 + 3}
                textAnchor="end"
                fontSize={9}
                fontFamily="var(--font-mono, monospace)"
                fill="currentColor"
                opacity={0.75}
              >
                {d.value.length > 9 ? `${d.value.slice(0, 8)}…` : d.value}
              </text>
              <rect x={LABEL_W} y={i * ROW_H + 2} width={w} height={ROW_H - 4} rx={2} fill={color}>
                <title>{`${d.value}\nCount: ${d.count.toLocaleString()}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      {remaining > 0 && (
        <Text fontSize="3xs" color="fg.subtle" fontFamily="mono" mt={0.5}>
          +{remaining.toLocaleString()} more
        </Text>
      )}
    </Box>
  )
}
