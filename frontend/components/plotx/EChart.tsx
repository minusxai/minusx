import { useMemo, useRef, useEffect } from 'react'
import '@/lib/chart/echarts-init'
import { init, getInstanceByDom } from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import type { EChartsOption, SetOptionOpts } from 'echarts'
import { debounce } from 'lodash'

// Module-scoped defaults: previously these lived in the function signature as
// inline `{}` / `{ ... }` literals, which gave them a fresh identity on every
// render. Listing them in the init effect's dep array then caused dispose →
// init on every parent re-render. If `option` happened to be stable across
// that render, setOption never fired on the new instance and the chart
// rendered blank. Hoisting these makes the defaults reference-stable.
const DEFAULT_CHART_SETTINGS = { useCoarsePointer: true } as const
const DEFAULT_OPTION_SETTINGS: SetOptionOpts = { notMerge: true }
const DEFAULT_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: '300px',
  display: 'flex',
  justifyContent: 'center',
}
const EMPTY_EVENTS: Record<string, (param: any) => void> = {}

interface EChartProps extends React.HTMLAttributes<HTMLDivElement> {
  option: EChartsOption
  chartSettings?: { useCoarsePointer?: boolean; renderer?: 'canvas' | 'svg' }
  optionSettings?: SetOptionOpts
  style?: React.CSSProperties
  loading?: boolean
  events?: Record<string, (param: any) => void>
  onChartUpdate?: (chart: EChartsType) => void
}

/**
 * Create a div that injects the ECharts canvas via ref
 *
 * @url https://echarts.apache.org/en/index.html
 * @example https://echarts.apache.org/examples/en/index.html
 */
export const EChart = ({
  option,
  chartSettings = DEFAULT_CHART_SETTINGS,
  optionSettings = DEFAULT_OPTION_SETTINGS,
  style = DEFAULT_STYLE,
  loading = false,
  events = EMPTY_EVENTS,
  onChartUpdate,
  ...props
}: EChartProps) => {
  const chartRef = useRef<HTMLDivElement>(null)

  // Stable refs so the init effect can stay mount-only — callers commonly pass
  // inline `events={{ click: ... }}` / new `onChartUpdate` each render, and we
  // don't want either to tear the chart down.
  const onChartUpdateRef = useRef(onChartUpdate)
  const eventsRef = useRef(events)
  useEffect(() => { onChartUpdateRef.current = onChartUpdate })
  useEffect(() => { eventsRef.current = events })

  // Debounce resize event so it only fires periodically instead of constantly
  const resizeChart = useMemo(
    () =>
       
      debounce(() => {
        if (chartRef.current) {
          const chart = getInstanceByDom(chartRef.current)
          if (chart) {
            chart.resize()
            onChartUpdateRef.current?.(chart)
          }
        }
      }, 100),
    []
  )

  // Mount-only: create the chart, wire events, observe resize. We also seed
  // the initial option here so a brand-new instance is never left blank if the
  // option-change effect happens to short-circuit (stable `option` reference).
  useEffect(() => {
    if (!chartRef.current) return

    const chart = init(chartRef.current, null, chartSettings)
    chart.setOption(option, optionSettings)
    onChartUpdateRef.current?.(chart)

    for (const [key, handler] of Object.entries(eventsRef.current)) {
      chart.on(key, (param) => {
        handler(param)
      })
    }

    const resizeObserver = new ResizeObserver(() => {
      resizeChart()
    })
    const currentRef = chartRef.current
    resizeObserver.observe(currentRef)

    return () => {
      // Dispatch hideTip first to flush any pending tooltip-show callback
      // ECharts may have scheduled (animation frame / setTimeout). Without
      // this, navigating away mid-hover left a deferred `setContent` racing
      // against the about-to-be-disposed tooltip DOM, producing the Sentry
      // MINUSX-BI-C "Cannot set properties of null (setting 'innerHTML')"
      // TypeError from inside `TooltipHTMLContent.setContent`.
      try { chart?.dispatchAction({ type: 'hideTip' }) } catch { /* chart may already be in a partial-teardown state */ }
      chart?.dispose()
      resizeObserver.unobserve(currentRef)
      resizeObserver.disconnect()
    }
    // chartSettings is included so a caller that explicitly switches renderer
    // (canvas ↔ svg) gets a fresh instance. With the module-scoped default,
    // identity is stable across normal re-renders. `option` / `optionSettings`
    // are intentionally NOT in the deps — the second effect handles updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSettings, resizeChart])

  useEffect(() => {
    // Re-render chart when option changes
    if (chartRef.current) {
      const chart = getInstanceByDom(chartRef.current)
      if (chart && option) {
        chart.setOption(option, optionSettings)
        onChartUpdateRef.current?.(chart)
      }
    }
  }, [option, optionSettings])

  return <div ref={chartRef} style={style} {...props} />
}
