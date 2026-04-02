/**
 * ECharts tree-shaking setup — import this file once (via EChart.tsx) before any echarts.init() call.
 * Only the components/charts/features actually used in this codebase are registered.
 * Do NOT import from 'echarts' directly for runtime use — use 'echarts/core' instead.
 */
import * as echarts from 'echarts/core';

// Chart types used: line/area (LineChart), bar/waterfall (BarChart), scatter, pie, funnel
import { LineChart, BarChart, ScatterChart, PieChart, FunnelChart } from 'echarts/charts';

// Components used across all chart files
import {
  TitleComponent,     // title: { text: '...' }
  TooltipComponent,   // tooltip: { trigger: 'axis' | 'item' }
  GridComponent,      // xAxis / yAxis grid
  LegendComponent,    // legend: { data: [...] }
  ToolboxComponent,   // toolbox: { feature: { ... } } (PNG + CSV download)
  GraphicComponent,   // graphic: [...] custom annotation overlays
} from 'echarts/components';

// Features for label layout (pie outside labels) and animated transitions
import { LabelLayout, UniversalTransition } from 'echarts/features';

// Canvas renderer — all charts use renderer: 'canvas'
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  PieChart,
  FunnelChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  GraphicComponent,
  LabelLayout,
  UniversalTransition,
  CanvasRenderer,
]);
