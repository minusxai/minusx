'use client'

import { useId } from 'react'

interface VizCssScopeProps {
  /** Raw CSS (styleConfig.cssOverrides) — bare selectors like `thead th { … }`, scoped here. */
  css?: string | null
  /** Viz type, exposed as a stable `mx-viz-<type>` class hook. */
  vizType: string
  children: React.ReactNode
}

/**
 * The cssOverrides escape hatch for DOM-rendered visualizations (table, pivot, trend,
 * single_value, geo). Wraps the viz in a layout-transparent (`display: contents`) div with a
 * unique scope class and emits the raw CSS nested under it — native CSS nesting confines the
 * agent's bare selectors (`td { … }`, `.mx-sv-value { … }`) to this one visualization.
 * ECharts (canvas) types ignore CSS; they use styleConfig.echartsOverrides instead.
 */
export function VizCssScope({ css, vizType, children }: VizCssScopeProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  if (!css) return <>{children}</>
  const scopeClass = `mx-viz-scope-${id}`
  return (
    <div className={`mx-viz mx-viz-${vizType} ${scopeClass}`} style={{ display: 'contents' }}>
      <style>{`.${scopeClass} { ${css} }`}</style>
      {children}
    </div>
  )
}
