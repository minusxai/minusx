import type { EChartsOption } from 'echarts'

/**
 * MinusX BI ECharts Theme
 * Based on Flat UI Colors and the design system in CLAUDE.md
 * Uses JetBrains Mono for all data/labels (monospace)
 * Uses Inter for titles/legends
 */

// Flat UI Colors from theme.ts
export const CHART_COLORS = {
  primary: '#2980b9',      // Belize Hole (blue)
  danger: '#c0392b',       // Pomegranate (red)
  teal: '#16a085',         // Green Sea (teal)
  purple: '#9b59b6',       // Amethyst (purple)
  success: '#2ecc71',      // Emerald (green)
  warning: '#f39c12',      // Orange
  // Additional colors for multi-series
  turquoise: '#1abc9c',    // Turquoise
  nephritis: '#27ae60',    // Nephritis (dark green)
  peterRiver: '#3498db',   // Peter River (light blue)
  wisteria: '#8e44ad',     // Wisteria (dark purple)
  sunflower: '#f1c40f',    // Sun Flower (yellow)
  carrot: '#e67e22',       // Carrot (dark orange)
}

// Color palette for multi-series charts
export const COLOR_PALETTE = [
  CHART_COLORS.teal,       // 1. Teal
  CHART_COLORS.primary,    // 2. Blue
  CHART_COLORS.danger,     // 3. Red
  CHART_COLORS.warning,    // 4. Orange
  CHART_COLORS.purple,     // 5. Purple
  CHART_COLORS.success,    // 6. Green
  CHART_COLORS.turquoise,  // 7. Turquoise
  CHART_COLORS.peterRiver, // 8. Light Blue
  CHART_COLORS.wisteria,   // 9. Dark Purple
  CHART_COLORS.carrot,     // 10. Dark Orange
]

// Light mode colors (matching theme.ts)
const LIGHT_THEME = {
  bgCanvas: '#FAFBFC',
  bgSurface: '#FFFFFF',
  bgMuted: '#F6F8FA',
  fgDefault: '#0D1117',
  fgMuted: '#57606A',
  fgSubtle: '#8B949E',
  borderDefault: '#D0D7DE',
  borderMuted: '#E5E9ED',
}

// Dark mode colors (matching theme.ts)
const DARK_THEME = {
  bgCanvas: '#0D1117',
  bgSurface: '#161B22',
  bgMuted: '#010409',
  fgDefault: '#E6EDF3',
  fgMuted: '#8B949E',
  fgSubtle: '#6E7681',
  borderDefault: '#30363D',
  borderMuted: '#21262D',
}

/**
 * Get theme colors based on color mode
 */
const getThemeColors = (colorMode: 'light' | 'dark') => {
  return colorMode === 'light' ? LIGHT_THEME : DARK_THEME
}

/**
 * Base ECharts theme configuration for MinusX BI
 * Apply this to all charts for consistent styling
 */
const getMinusXTheme = (colorMode: 'light' | 'dark'): EChartsOption => {
  const theme = getThemeColors(colorMode)

  return {
    color: COLOR_PALETTE,

    backgroundColor: 'transparent',

    textStyle: {
      fontFamily: 'JetBrains Mono, Consolas, Monaco, Courier New, monospace',
      fontSize: 12,
      color: theme.fgMuted,
    },

    title: {
      textStyle: {
        fontFamily: 'JetBrains Mono, Consolas, Monaco, Courier New, monospace',
        fontSize: 16,
        fontWeight: 700,
        color: theme.fgDefault,
      },
      subtextStyle: {
        fontFamily: 'JetBrains Mono, Consolas, Monaco, Courier New, monospace',
        fontSize: 13,
        color: theme.fgDefault,
      },
    },

    legend: {
      textStyle: {
        fontFamily: 'JetBrains Mono, Consolas, Monaco, Courier New, monospace',
        fontSize: 12,
        color: theme.fgDefault,
      },
      inactiveColor: theme.fgSubtle,
      itemWidth: 25,
      itemHeight: 12,
      // Note: icon is set per series in individual charts
    },

    tooltip: {
      backgroundColor: colorMode === 'light' ? 'rgba(255, 255, 255, 0.95)' : 'rgba(22, 27, 34, 0.95)',
      borderColor: theme.borderDefault,
      borderWidth: 1,
      textStyle: {
        fontFamily: 'JetBrains Mono, Consolas, Monaco, Courier New, monospace',
        fontSize: 12,
        color: theme.fgDefault,
      },
      axisPointer: {
        lineStyle: {
          color: theme.borderDefault,
          type: 'dashed',
        },
        crossStyle: {
          color: theme.borderDefault,
          type: 'dashed',
        },
      },
    },

    grid: {
      left: '60px',
      right: '60px',  // Match left padding to accommodate right Y-axis names
      top: '60px',
      bottom: '60px',
      containLabel: true,  // Auto-expand grid to fit axis labels and names
    },

    // Note: xAxis and yAxis configurations are handled in withMinusXTheme()
    // to avoid TypeScript union type issues

    line: {
      smooth: true,
      symbol: 'none', // No dots on the line
      showSymbol: false, // Hide symbols completely
      lineStyle: {
        width: 2,
      },
      emphasis: {
        focus: 'series',
      },
    },

    bar: {
      itemStyle: {
        borderRadius: [4, 4, 0, 0],
      },
      emphasis: {
        focus: 'series',
      },
    },

    scatter: {
      symbolSize: 8,
      emphasis: {
        focus: 'series',
        itemStyle: {
          borderColor: colorMode === 'light' ? '#000' : '#fff',
          borderWidth: 2,
        },
      },
    },
  }
}

/**
 * Get axis defaults based on color mode
 */
const getAxisDefaults = (colorMode: 'light' | 'dark') => {
  const theme = getThemeColors(colorMode)

  return {
    axisLine: {
      lineStyle: {
        color: theme.borderDefault,
      },
    },
    axisTick: {
      lineStyle: {
        color: theme.borderMuted,
      },
    },
    axisLabel: {
      fontFamily: 'JetBrains Mono, Consolas, Monaco, Courier New, monospace',
      fontSize: 11,
      color: theme.fgMuted,
    },
    splitLine: {
      lineStyle: {
        color: theme.borderDefault,
        type: 'dashed' as const,
      },
    },
    nameTextStyle: {
      fontFamily: 'JetBrains Mono, Consolas, Monaco, Courier New, monospace',
      fontSize: 16,
      fontWeight: 600,
      color: theme.fgDefault,
    },
    nameGap: 30,
    nameLocation: 'middle' as const,
  }
}

/**
 * Format tooltip values to 2 decimal places
 * Use this in tooltip.valueFormatter for all charts
 */
export const formatTooltipValue = (value: any): string => {
  if (typeof value === 'number') {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
  return String(value)
}

/**
 * Merge user options with MinusX theme
 * Use this helper to ensure theme is consistently applied
 */
export function withMinusXTheme(options: EChartsOption, colorMode: 'light' | 'dark' = 'dark'): EChartsOption {
  const minusXTheme = getMinusXTheme(colorMode)
  const axisDefaults = getAxisDefaults(colorMode)

  const mergedOptions: EChartsOption = {
    ...minusXTheme,
    ...options,
    // Deep merge specific properties
    textStyle: {
      ...minusXTheme.textStyle,
      ...options.textStyle,
    },
    tooltip: {
      ...minusXTheme.tooltip,
      ...options.tooltip,
      // Always add valueFormatter for 2 decimal places
      valueFormatter: formatTooltipValue,
    },
    grid: {
      ...minusXTheme.grid,
      ...options.grid,
    },
    ...(options.title ? {
      title: {
        ...minusXTheme.title,
        ...options.title,
        textStyle: {
          ...(minusXTheme.title as any)?.textStyle,
          ...(options.title as any)?.textStyle,
        },
      },
    } : {}),
  }

  // Handle legend - deep merge to preserve theme styling
  if (options.legend) {
    const userLegend = Array.isArray(options.legend) ? options.legend[0] : options.legend
    const themeLegend = Array.isArray(minusXTheme.legend) ? minusXTheme.legend[0] : minusXTheme.legend
    mergedOptions.legend = {
      ...themeLegend,
      ...userLegend,
      textStyle: {
        ...themeLegend?.textStyle,
        ...userLegend?.textStyle,
      },
    }
  }

  // Handle xAxis - merge with axis defaults
  if (options.xAxis) {
    const userXAxis = Array.isArray(options.xAxis) ? options.xAxis[0] : options.xAxis
    const baseXAxis: any = { ...userXAxis }

    // Apply axis defaults
    baseXAxis.axisLine = { ...axisDefaults.axisLine, ...baseXAxis.axisLine }
    baseXAxis.axisTick = { ...axisDefaults.axisTick, ...baseXAxis.axisTick }
    baseXAxis.splitLine = { ...axisDefaults.splitLine, ...baseXAxis.splitLine }

    // IMPORTANT: Merge axisLabel with defaults FIRST, then user options
    baseXAxis.axisLabel = {
      ...axisDefaults.axisLabel,
      ...(baseXAxis.axisLabel || {}),
    }

    // Apply name text styling if name is provided
    if (baseXAxis.name) {
      baseXAxis.nameTextStyle = {
        ...axisDefaults.nameTextStyle,
        ...(baseXAxis.nameTextStyle || {}),
      }
      if (!baseXAxis.nameGap) baseXAxis.nameGap = axisDefaults.nameGap
      if (!baseXAxis.nameLocation) baseXAxis.nameLocation = axisDefaults.nameLocation
    }

    mergedOptions.xAxis = baseXAxis
  }

  // Handle yAxis - merge with axis defaults (supports single or multiple axes)
  if (options.yAxis) {
    const applyYAxisDefaults = (axis: any) => {
      const baseAxis: any = { ...axis }

      // Apply axis defaults
      baseAxis.axisLine = { show: false } // yAxis typically doesn't show line
      baseAxis.axisTick = { show: false }
      baseAxis.splitLine = { ...axisDefaults.splitLine, ...baseAxis.splitLine }

      // IMPORTANT: Merge axisLabel with defaults FIRST, then user options
      baseAxis.axisLabel = {
        ...axisDefaults.axisLabel,
        ...(baseAxis.axisLabel || {}),
      }

      // Apply name text styling if name is provided
      if (baseAxis.name) {
        baseAxis.nameTextStyle = {
          ...axisDefaults.nameTextStyle,
          ...(baseAxis.nameTextStyle || {}),
        }
        if (!baseAxis.nameGap) baseAxis.nameGap = 50 // Y-axis needs more space
        if (!baseAxis.nameLocation) baseAxis.nameLocation = axisDefaults.nameLocation
      }

      return baseAxis
    }

    // Handle both single axis and multiple axes (dual Y-axis)
    if (Array.isArray(options.yAxis)) {
      mergedOptions.yAxis = options.yAxis.map(axis => applyYAxisDefaults(axis))
    } else {
      mergedOptions.yAxis = applyYAxisDefaults(options.yAxis)
    }
  }

  return mergedOptions
}
