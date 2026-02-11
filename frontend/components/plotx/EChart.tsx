import { useMemo, useRef, useEffect } from 'react'
import { init, getInstanceByDom, EChartsOption } from 'echarts'
import type { SetOptionOpts } from 'echarts'
import { debounce } from 'lodash'

interface EChartProps extends React.HTMLAttributes<HTMLDivElement> {
  option: EChartsOption
  chartSettings?: { useCoarsePointer?: boolean; renderer?: 'canvas' | 'svg' }
  optionSettings?: SetOptionOpts
  style?: React.CSSProperties
  loading?: boolean
  events?: Record<string, (param: any) => void>
}

/**
 * Create a div that injects the ECharts canvas via ref
 *
 * @url https://echarts.apache.org/en/index.html
 * @example https://echarts.apache.org/examples/en/index.html
 */
export const EChart = ({
  option,
  chartSettings = { useCoarsePointer: true }, // enables clicking near a line and still highlighting it
  optionSettings = { notMerge: true }, // don't merge two options together when updating option
  style = { width: '100%', height: '100%', minHeight: '300px', display: "flex", justifyContent: "center" },
  loading = false,
  events = {},
  ...props
}: EChartProps) => {
  const chartRef = useRef<HTMLDivElement>(null)

  // Debounce resize event so it only fires periodically instead of constantly
  const resizeChart = useMemo(
    () =>
      debounce(() => {
        if (chartRef.current) {
          const chart = getInstanceByDom(chartRef.current)
          chart?.resize()
        }
      }, 100),
    []
  )

  useEffect(() => {
    if (!chartRef.current) return

    // Initialize chart
    const chart = init(chartRef.current, null, chartSettings)

    // Set up event listeners
    for (const [key, handler] of Object.entries(events)) {
      chart.on(key, (param) => {
        handler(param)
      })
    }

    // Resize event listener
    const resizeObserver = new ResizeObserver(() => {
      resizeChart()
    })

    const currentRef = chartRef.current
    resizeObserver.observe(currentRef)

    // Return cleanup function
    return () => {
      chart?.dispose()
      resizeObserver.unobserve(currentRef)
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    // Re-render chart when option changes
    if (chartRef.current) {
      const chart = getInstanceByDom(chartRef.current)
      if (chart && option) {
        chart.setOption(option, optionSettings)
      }
    }
  }, [option, optionSettings])

  return <div ref={chartRef} style={style} {...props} />
}
