/**
 * finalizeChartOption — the single funnel every ECharts option passes through:
 *   theme (withMinusXTheme) → curated style levers → echartsOverrides (LAST, wins over everything).
 * The curated levers (background/legend/textColor/titleColor/smooth) and the escape hatch are
 * what make the agent's styling both possible and honest in the re-rendered feedback images.
 */
import { describe, it, expect } from 'vitest';
import { finalizeChartOption } from '../echarts-theme';
import { buildChartOption, buildPieChartOption } from '../chart-utils';
import { COLOR_PALETTE } from '../echarts-theme';
import type { VisualizationStyleConfig } from '@/lib/validation/atlas-schemas';

const buildBar = (styleConfig?: VisualizationStyleConfig | null, extra?: Record<string, unknown>) =>
  buildChartOption({
    xAxisData: ['Jan', 'Feb', 'Mar'],
    series: [
      { name: 'revenue', data: [100, 200, 150] },
      { name: 'cost', data: [40, 80, 60] },
    ],
    chartType: 'bar',
    colorPalette: COLOR_PALETTE,
    colorMode: 'light',
    styleConfig: styleConfig ?? undefined,
    chartTitle: 'revenue vs Jan',
    ...extra,
  });

const legendOf = (option: Record<string, any>) =>
  Array.isArray(option.legend) ? option.legend[0] : option.legend;

describe('curated levers land in the final option', () => {
  it('background → backgroundColor', () => {
    expect((buildBar({ background: '#101822' }) as any).backgroundColor).toBe('#101822');
    // untouched: theme default (transparent) preserved
    expect((buildBar() as any).backgroundColor).not.toBe('#101822');
  });

  it('legend.show=false hides the legend (bar and pie)', () => {
    expect(legendOf(buildBar({ legend: { show: false } }) as any).show).toBe(false);
    const pie = buildPieChartOption({
      xAxisData: ['a', 'b'],
      series: [{ name: 'v', data: [1, 2] }],
      colorMode: 'light',
      colorPalette: COLOR_PALETTE,
      styleConfig: { legend: { show: false } },
    } as any);
    expect(legendOf(pie as any).show).toBe(false);
  });

  it('legend.position=bottom moves the legend to the bottom, horizontal', () => {
    const legend = legendOf(buildBar({ legend: { position: 'bottom' } }) as any);
    expect(legend.bottom).toBeDefined();
    expect(legend.top).toBeUndefined();
    expect(legend.orient).toBe('horizontal');
  });

  it('legend.position=right goes vertical on the right', () => {
    const legend = legendOf(buildBar({ legend: { position: 'right' } }) as any);
    expect(legend.right).toBeDefined();
    expect(legend.orient).toBe('vertical');
  });

  it('textColor colors axis labels and legend text', () => {
    const option = buildBar({ textColor: '#f7f0df' }) as any;
    const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
    const yAxis = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis;
    expect(xAxis.axisLabel.color).toBe('#f7f0df');
    expect(yAxis.axisLabel.color).toBe('#f7f0df');
    expect(legendOf(option).textStyle.color).toBe('#f7f0df');
  });

  it('textColor covers BOTH axes in dual-axis mode', () => {
    const option = buildBar({ textColor: '#f7f0df' }, {
      yRightCols: ['cost'],
      axisConfig: { dualAxis: true },
      yAxisColumns: ['revenue', 'cost'],
    }) as any;
    const axes = Array.isArray(option.yAxis) ? option.yAxis : [option.yAxis];
    expect(axes.length).toBe(2);
    for (const axis of axes) expect(axis.axisLabel.color).toBe('#f7f0df');
  });

  it('titleColor colors the chart title', () => {
    const option = buildBar({ titleColor: '#e8a33d' }) as any;
    expect(option.title.textStyle.color).toBe('#e8a33d');
  });

  it('smooth=false switches line series to straight segments', () => {
    const option = buildChartOption({
      xAxisData: ['Jan', 'Feb'],
      series: [{ name: 'revenue', data: [1, 2] }],
      chartType: 'line',
      colorPalette: COLOR_PALETTE,
      styleConfig: { smooth: false },
    }) as any;
    const series = Array.isArray(option.series) ? option.series : [option.series];
    for (const s of series) expect(s.smooth).toBe(false);
  });
});

describe('echartsOverrides — merged LAST, beats theme and curated levers', () => {
  it('beats a curated lever set in the same styleConfig', () => {
    const option = buildBar({
      legend: { show: false },
      echartsOverrides: { legend: { show: true, itemGap: 24 } },
    }) as any;
    expect(legendOf(option).show).toBe(true);
    expect(legendOf(option).itemGap).toBe(24);
  });

  it('beats theme defaults (grid) while deep-merging (other grid keys survive)', () => {
    const option = buildBar({ echartsOverrides: { grid: { left: 8 } } }) as any;
    expect(option.grid.left).toBe(8);
    expect(option.grid.containLabel).toBe(true); // theme default survives the deep merge
  });

  it('replaces arrays wholesale', () => {
    const option = buildBar({ echartsOverrides: { series: [{ type: 'bar', data: [9] }] } }) as any;
    expect(option.series).toEqual([{ type: 'bar', data: [9] }]);
  });

  it('finalizeChartOption applies overrides directly on a bare option', () => {
    const out = finalizeChartOption(
      { xAxis: { type: 'category' } },
      { colorMode: 'light', styleConfig: { echartsOverrides: { animation: true } } },
    ) as any;
    expect(out.animation).toBe(true);
  });
});
