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

## Why some types are not image-rendered

- **`table`**: The data itself IS the visualization. The LLM already receives the full query result as a markdown table in the text response.
- **`pivot`**: Same reasoning as table — it's a cross-tab of the data. The LLM gets the underlying rows and can reason about pivoted values from the text.
- **`trend`**: Purely textual KPI cards (big number + percent change + arrow). No actual chart/graph. The LLM already gets the series values in the markdown table and can trivially derive current value and trend direction — an image of "8,801 +12.3%" adds nothing over the numbers themselves.
- **`geo`**: Leaflet-based map rendering requires a browser with `window` (dynamic import, ssr:false). No server-side rendering path exists. Would need a fundamentally different approach (e.g., static map tile service).

## Key Files

- **Type enum (source of truth)**: `backend/tasks/agents/analyst/file_schema.py` -> `VisualizationType`
- **Generated TS type**: `frontend/lib/types.gen.ts` -> `VisualizationType`
- **Chart routing**: `frontend/components/plotx/ChartBuilder.tsx` (line ~788, `plotMap`)
- **Renderable set + aspect ratios**: `frontend/lib/chart/render-chart-svg.ts`
- **ECharts option builders**: `frontend/lib/chart/chart-utils.ts`
- **Image renderers**: `frontend/lib/chart/ChartImageRenderer.{client,server}.ts`
- **Viz type selector UI**: `frontend/components/question/VizTypeSelector.tsx`
