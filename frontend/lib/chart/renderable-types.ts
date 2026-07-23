/**
 * Which V1 chart types produce a rendered image, and their default aspect — engine-free
 * survivors of the deleted ECharts SSR renderer (Renderer_v2 Phase 2). The types themselves
 * now render through the Vega bridge; these constants gate image pipelines and size outputs.
 */

const CHART_ASPECT_RATIO: Record<string, number> = {
  line:      0.5625,  // 16:9
  bar:       0.5625,
  row:       0.75,    // 4:3 — horizontal bars need more vertical room
  area:      0.5625,
  scatter:   0.5625,
  pie:       1,       // 1:1 — outside labels need vertical room
  funnel:    0.5625,  // 16:9 — horizontal funnel needs width
  waterfall: 0.5625,
  radar:     1,       // 1:1
  combo:     0.5625,  // 16:9
};

export const RENDERABLE_CHART_TYPES = new Set(['line', 'bar', 'row', 'area', 'scatter', 'pie', 'funnel', 'waterfall', 'radar', 'combo']);

export function getChartHeight(vizType: string, width: number): number {
  const ratio = CHART_ASPECT_RATIO[vizType] ?? 0.5625;
  return Math.round(width * ratio);
}
