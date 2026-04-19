import type { VisualizationType } from '@/lib/types.gen'

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
    case 'trend':
      if (xColCount > 0 && xColTypes && xColTypes.some(t => t !== 'date')) {
        return { error: 'Trend charts require a date/time column on the X axis.' }
      }
      return { error: null }

    case 'combo':
      if (yColCount < 2) return { error: 'Combo charts require at least 2 Y-axis columns (first becomes bar, rest become lines).' }
      if (xColCount < 1) return { error: 'Combo charts require at least 1 X-axis column.' }
      return { error: null }

    case 'waterfall':
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

    case 'geo':
      // Geo validates via its own getGeoConstraintError in geo-constraints.ts
      return { error: null }

    default:
      return { error: null }
  }
}
