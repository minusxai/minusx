import type { EChartsOption } from 'echarts'
import { withMinusXTheme, getChartFontFamily } from '../echarts-theme'
import { resolveChartFormats } from '../chart-format'
import {
  tooltipAppendTo,
  buildChartTitleOption,
  buildToolbox,
  withAlpha,
  type SpecialChartOptionConfig,
} from '../chart-utils'

export const buildRadarChartOption = ({
  xAxisData,
  series,
  colorMode = 'dark',
  containerWidth,
  columnFormats,
  xAxisColumns,
  yAxisColumns,
  chartTitle,
  showChartTitle = true,
  colorPalette,
  styleConfig,
  exportBranding,
  downloadCsv,
  onDownloadImage,
}: SpecialChartOptionConfig): EChartsOption => {
  const { fmtName, fmtValue } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)

  // Each X-axis value becomes a spoke/indicator on the radar
  // Use a single shared max across all spokes so shapes are directly comparable
  const globalMax = Math.ceil(
    Math.max(...xAxisData.flatMap((_, i) =>
      series.map(s => {
        const v = s.data[i]
        return typeof v === 'number' && !isNaN(v) ? v : 0
      })
    )) * 1.2
  ) || 1

  const indicators = xAxisData.map((name) => ({
    name: fmtName(name),
    max: globalMax,
  }))

  // Build radar data entries — one per series (Y column or split-by group)
  const radarData = series.map((s, idx) => ({
    value: s.data.map(v => (typeof v === 'number' && !isNaN(v) ? v : 0)),
    name: s.name,
    symbol: 'circle' as const,
    symbolSize: 5,
    lineStyle: {
      width: 2,
      color: colorPalette[idx % colorPalette.length],
    },
    areaStyle: {
      color: withAlpha(colorPalette[idx % colorPalette.length], 0.25),
      ...(styleConfig?.opacity != null ? { opacity: styleConfig.opacity } : {}),
    },
    itemStyle: {
      color: colorPalette[idx % colorPalette.length],
    },
  }))

  const isDark = colorMode === 'dark'

  const baseOption: EChartsOption = {
    ...buildChartTitleOption(chartTitle, showChartTitle ?? true, containerWidth),
    ...((downloadCsv || onDownloadImage) ? {
      toolbox: buildToolbox({
        colorMode,
        downloadCsv,
        chartTitle,
        exportBranding,
        onDownloadImage,
      }),
    } : {}),
    tooltip: {
      trigger: 'item',
      appendTo: tooltipAppendTo,
      z: 9999,
      confine: false,
      formatter: (params: any) => {
        const { name, value } = params
        if (!Array.isArray(value)) return name
        const lines = indicators.map((ind, i) =>
          `${ind.name}: ${fmtValue(value[i] ?? 0)}`
        )
        return `<strong>${name}</strong><br/>${lines.join('<br/>')}`
      },
    },
    legend: {
      data: series.map(s => s.name),
      top: chartTitle && showChartTitle ? 35 : 10,
      orient: 'horizontal',
      type: 'scroll',
      pageIconSize: 10,
      pageTextStyle: { fontSize: 10 },
    },
    radar: {
      indicator: indicators,
      shape: 'polygon',
      splitNumber: 4,
      center: ['50%', '55%'],
      radius: '65%',
      axisName: {
        color: isDark ? '#a0aec0' : '#4a5568',
        fontSize: 11,
        fontFamily: getChartFontFamily(),
      },
      axisLabel: {
        show: false,
      },
      splitArea: {
        areaStyle: {
          color: isDark
            ? ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.04)']
            : ['rgba(0,0,0,0.01)', 'rgba(0,0,0,0.03)'],
        },
      },
      splitLine: {
        lineStyle: {
          color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        },
      },
      axisLine: {
        lineStyle: {
          color: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
        },
      },
    },
    series: [
      {
        type: 'radar',
        data: radarData,
        emphasis: {
          lineStyle: { width: 3 },
          areaStyle: { opacity: 0.3 },
        },
      },
    ],
  }

  return withMinusXTheme(baseOption, colorMode, colorPalette)
}
