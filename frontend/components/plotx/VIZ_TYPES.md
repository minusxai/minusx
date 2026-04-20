# Visualization Types Reference

Single source of truth for all viz type capabilities and rendering details.

The canonical type union is `VisualizationType` in `backend/tasks/agents/analyst/file_schema.py` (generates `frontend/lib/types.gen.ts`).

## Type Matrix

| Type | Renderer | Axis Builder | Image Renderable | Aspect Ratio | Notes |
|------|----------|--------------|------------------|--------------|-------|
| `table` | `TableV2` (custom) | None | No | N/A | Raw data grid, default viz type |
| `bar` | `BarPlot` (ECharts) | `AxisBuilder` (X/Y drop zones) | Yes | 16:9 | Supports dual Y-axis, drill-down |
| `line` | `LinePlot` (ECharts) | `AxisBuilder` | Yes | 16:9 | Supports dual Y-axis, annotations |
| `area` | `AreaPlot` (ECharts) | `AxisBuilder` | Yes | 16:9 | Stacked area variant of line |
| `scatter` | `ScatterPlot` (ECharts) | `AxisBuilder` | Yes | 16:9 | |
| `pie` | `PiePlot` (ECharts) | `AxisBuilder` | Yes | 1:1 | Nested donut when 2+ Y cols, outside labels |
| `funnel` | `FunnelPlot` (ECharts) | `AxisBuilder` | Yes | 16:9 | Horizontal funnel |
| `waterfall` | `WaterfallPlot` (ECharts) | `AxisBuilder` | Yes | 16:9 | |
| `combo` | `ComboPlot` (ECharts) | `AxisBuilder` | Yes | 16:9 | Mixed bar+line, dual Y-axis |
| `radar` | `RadarPlot` (ECharts) | `AxisBuilder` | Yes | 1:1 | Spider/radar chart |
| `pivot` | `PivotTable` (custom) | `PivotAxisBuilder` (Rows/Cols/Values) | No | N/A | Cross-tab with heatmap, subtotals, collapsible groups |
| `trend` | `TrendPlot` / `SingleValue` (custom) | `TrendAxisBuilder` | No | N/A | KPI cards with sparklines, not ECharts |
| `geo` | `GeoPlot` (Leaflet) | `GeoAxisBuilder` | No | N/A | Choropleth/points/lines/heatmap, dynamic import (ssr:false) |

## Key Definitions

- **Renderer**: The React component that renders the chart. ECharts types use `BaseChart` wrapper.
- **Axis Builder**: The drag-drop UI for configuring columns. Most use `AxisBuilder` (X/Y zones); pivot, trend, and geo have specialized builders.
- **Image Renderable**: Whether `RENDERABLE_CHART_TYPES` includes it. These can be server-side rendered (SVG -> JPEG) and sent as images to the LLM in tool results. Defined in `lib/chart/render-chart-svg.ts`.
- **Aspect Ratio**: Image render height-to-width ratio from `CHART_ASPECT_RATIO` in `lib/chart/render-chart-svg.ts`. Only applies to image-renderable types.

## Key Files

- **Type enum (source of truth)**: `backend/tasks/agents/analyst/file_schema.py` -> `VisualizationType`
- **Generated TS type**: `frontend/lib/types.gen.ts` -> `VisualizationType`
- **Chart routing**: `frontend/components/plotx/ChartBuilder.tsx` (line ~788, `plotMap`)
- **Renderable set + aspect ratios**: `frontend/lib/chart/render-chart-svg.ts`
- **ECharts option builders**: `frontend/lib/chart/chart-utils.ts`
- **Image renderers**: `frontend/lib/chart/ChartImageRenderer.{client,server}.ts`
- **Viz type selector UI**: `frontend/components/question/VizTypeSelector.tsx`
