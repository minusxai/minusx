import type { VisualizationType, VizSettings } from '@/lib/validation/atlas-schemas'
import { getColumnType } from '@/lib/database/column-types'
import { VIZ_CAPABILITIES } from './viz-capabilities'

export interface ConstraintResult {
  error: string | null
  /** 'info' constraints are softer hints (e.g. "need 3+ categories"), default is 'warning' */
  variant?: 'warning' | 'info'
}

interface ConstraintInput {
  xColCount: number
  yColCount: number
  /** Number of unique X-axis data points after aggregation (only available at render time) */
  xDataCount?: number
  /** Resolved column types for X-axis columns (e.g. 'date', 'number', 'text') */
  xColTypes?: Array<'date' | 'number' | 'text' | 'json'>
}

/**
 * Centralized viz type constraint validation.
 *
 * Returns the first constraint violation found, or { error: null } if valid.
 * Called from ChartBuilder (pre-render) and individual plot components (render-time).
 */
export function getVizConstraintError(
  chartType: VisualizationType,
  input: ConstraintInput,
): ConstraintResult {
  const { xColCount, yColCount, xDataCount, xColTypes } = input

  switch (chartType) {
    case 'line':
    case 'bar':
    case 'row':
    case 'area':
    case 'scatter':
      if (xColCount < 1) return { error: `${chartType.charAt(0).toUpperCase() + chartType.slice(1)} charts require at least 1 X-axis column.` }
      return { error: null }

    case 'trend':
      if (xColCount < 1) return { error: 'Trend charts require a date/time column on the X axis.' }
      if (xColTypes && xColTypes.some(t => t !== 'date')) {
        return { error: 'Trend charts require a date/time column on the X axis.' }
      }
      return { error: null }

    case 'combo':
      if (yColCount < 2) return { error: 'Combo charts require at least 2 Y-axis columns (first becomes bar, rest become lines).' }
      if (xColCount < 1) return { error: 'Combo charts require at least 1 X-axis column.' }
      return { error: null }

    case 'waterfall':
      if (xColCount < 1) return { error: 'Waterfall charts require at least 1 X-axis column.' }
      if (xColCount > 1) return { error: 'Waterfall charts support only a single X-axis column. Remove extra columns from the X axis to continue.' }
      if (yColCount > 1) return { error: 'Waterfall charts support only a single Y-axis column. Remove extra columns from the Y axis to continue.' }
      return { error: null }

    case 'pie':
      if (xColCount < 1) return { error: 'Pie charts require at least 1 X-axis column for grouping.' }
      if (xColCount > 2) return { error: 'Pie charts support at most 2 X-axis columns (category + split). Remove extra columns from the X axis to continue.' }
      if (yColCount > 1) return { error: 'Pie charts support only a single Y-axis column. Remove extra columns from the Y axis to continue.' }
      return { error: null }

    case 'funnel':
      if (xColCount < 1) return { error: 'Funnel charts require at least 1 X-axis column for grouping.' }
      if (xColCount > 1) return { error: 'Funnel charts support only a single X-axis column. Remove extra columns from the X axis to continue.' }
      if (yColCount > 1) return { error: 'Funnel charts support only a single Y-axis column. Remove extra columns from the Y axis to continue.' }
      return { error: null }

    case 'radar':
      if (xColCount < 1) return { error: 'Radar charts require at least 1 X-axis column for indicators.' }
      if (xColCount > 1 && yColCount > 1) return { error: 'Radar charts support either multiple X columns (split-by) with 1 Y column, or 1 X column with multiple Y columns — not both.' }
      if (xColCount > 2) return { error: 'Radar charts support at most 2 X-axis columns (indicators + split-by).' }
      if (xDataCount != null && xDataCount < 3) return { error: 'Radar charts need at least 3 categories to display meaningfully. Add more data or choose a different chart type.', variant: 'info' }
      return { error: null }

    case 'single_value':
      if (yColCount > 1) return { error: 'Single value displays only 1 metric. Remove extra columns from Metrics to continue.' }
      return { error: null }

    case 'geo':
      // Geo validates via its own getGeoConstraintError in geo-constraints.ts
      return { error: null }

    default:
      return { error: null }
  }
}

/**
 * Check viz constraints and return a warning string (or null). Used by tool
 * handlers to feed constraint errors back to the LLM so it can fix a misconfigured
 * chart instead of finishing with a broken widget.
 *
 * Pass the executed query's `columns` + `types` so type-dependent constraints are
 * checked too — most importantly "trend charts require a date X axis", which the
 * chart RENDERER enforces but is invisible without column types. When omitted,
 * only structural constraints (column counts) are validated.
 */
/**
 * Registry-driven applicability check: warns when an escape hatch or style group is set on a
 * viz type whose renderer ignores it — so the agent learns immediately instead of believing
 * the styling landed. Deliberately limited to the NEW style fields (echartsOverrides,
 * cssOverrides, table): stale type-specific config groups (pivotConfig on a bar, …) are
 * intentionally preserved by the UI when switching viz types and must not warn.
 */
function getStyleLeverWarning(vizSettings: VizSettings): string | null {
  const cap = VIZ_CAPABILITIES[vizSettings.type]
  const styleConfig = vizSettings.styleConfig
  if (!cap || !styleConfig) return null
  if (styleConfig.echartsOverrides && Object.keys(styleConfig.echartsOverrides).length > 0 && !cap.levers.echartsOverrides) {
    return `styleConfig.echartsOverrides is ignored for '${vizSettings.type}' (${cap.renderer} renderer, not ECharts) — use styleConfig.cssOverrides for DOM-rendered types.`
  }
  if (styleConfig.cssOverrides && !cap.levers.cssOverrides) {
    return `styleConfig.cssOverrides is ignored for '${vizSettings.type}' (canvas-rendered by ECharts, CSS can't reach it) — use styleConfig.echartsOverrides instead.`
  }
  if (styleConfig.table && !cap.levers.styleConfig.includes('table')) {
    return `styleConfig.table is ignored for '${vizSettings.type}' — it only applies to the 'table' and 'pivot' viz types.`
  }
  return null
}

export function getVizSettingsWarning(
  vizSettings: VizSettings | undefined | null,
  columns?: string[],
  types?: string[],
): string | null {
  if (!vizSettings) return null
  const styleWarning = getStyleLeverWarning(vizSettings)
  if (styleWarning) return styleWarning
  if (vizSettings.type === 'table') return null
  const xCols = vizSettings.xCols ?? []
  const yCols = vizSettings.yCols ?? []
  const xColTypes =
    columns && types
      ? xCols.map((c) => {
          const i = columns.indexOf(c)
          return i >= 0 ? getColumnType(types[i]) : 'text'
        })
      : undefined
  const result = getVizConstraintError(vizSettings.type, {
    xColCount: xCols.length,
    yColCount: yCols.length,
    xColTypes,
  })
  return result.error
}
