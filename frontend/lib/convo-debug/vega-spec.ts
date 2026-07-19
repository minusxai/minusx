/**
 * TurnBar[] → Vega-Lite stacked-bar spec + data rows for the /debug viz.
 *
 * The spec deliberately omits `data`: the render pipeline injects the reserved
 * named dataset (`prepareVegaLiteSpec` → `data: {name:'main'}`), and the rows
 * returned here are bound to the view via `createVegaView(vegaSpec, rows, …)`.
 * Each row is one bar component, carrying `barIndex`/`componentIndex` so a
 * click on a segment can resolve back to the model for the inspect modal.
 */
import type { ComponentType, TurnBar } from './types';

/** Deterministic color assignment — one entry per possible component type. */
const COMPONENT_COLORS: Record<ComponentType, string> = {
  SystemPrompt: '#8e44ad',
  ToolDefinitions: '#9b7fb6',
  AppStateText: '#2980b9',
  AppStateImage: '#5dade2',
  FileMarkup: '#16a085',
  QueryData: '#48c9b0',
  UserText: '#27ae60',
  UserImages: '#82e0aa',
  Other: '#95a5a6',
  Thinking: '#f39c12',
  Text: '#e67e22',
  ToolCalls: '#d35400',
  ToolResult: '#c0392b',
  SubAgentLLM: '#7f8c8d',
};

export type CostMode = 'expected' | 'actual';

export interface DebugVegaRow extends Record<string, unknown> {
  barIndex: number;
  componentIndex: number;
  bar: string;
  component: string;
  toolName: string;
  tokens: number;
  cost: string;
  costMode: CostMode;
}

function formatUsd(v: number | null | undefined): string {
  if (v == null) return '—';
  return `$${v.toFixed(4)}`;
}

/** The ONE cost figure for a bar in the given mode (input: full call input slice; assistant: output). */
export function barCostLabel(bar: TurnBar, mode: CostMode): string {
  if (bar.cost.kind === 'output') {
    const side = mode === 'expected' ? bar.cost.expected : bar.cost.actual;
    return side ? `${formatUsd(side.totalUsd)} out` : '—';
  }
  const side = mode === 'expected' ? bar.cost.expected : bar.cost.actual;
  if (!side) return '—';
  return `${formatUsd(side.totalUsd)} in (${side.cachedTokens} cached / ${side.uncachedTokens} new)`;
}

export function buildDebugVegaSpec(
  bars: TurnBar[],
  costMode: CostMode,
): { spec: Record<string, unknown>; rows: DebugVegaRow[] } {
  const rows: DebugVegaRow[] = bars.flatMap((bar) =>
    bar.components.map((component, componentIndex) => ({
      barIndex: bar.index,
      componentIndex,
      bar: bar.label,
      component: component.type,
      toolName: component.toolName ?? '',
      tokens: component.tokens,
      cost: barCostLabel(bar, costMode),
      costMode,
    })),
  );

  const present = [...new Set(rows.map((r) => r.component))].sort(
    (a, b) => Object.keys(COMPONENT_COLORS).indexOf(a) - Object.keys(COMPONENT_COLORS).indexOf(b),
  );
  const spec: Record<string, unknown> = {
    mark: { type: 'bar', cursor: 'pointer' },
    encoding: {
      x: {
        field: 'bar',
        type: 'nominal',
        sort: { field: 'barIndex', op: 'min' },
        axis: { title: null, labelAngle: -30 },
      },
      y: { field: 'tokens', type: 'quantitative', aggregate: 'sum', axis: { title: 'approx tokens' } },
      color: {
        field: 'component',
        type: 'nominal',
        scale: { domain: present, range: present.map((t) => COMPONENT_COLORS[t as ComponentType]) },
      },
      order: { field: 'componentIndex', type: 'quantitative' },
      tooltip: [
        { field: 'bar', type: 'nominal' },
        { field: 'component', type: 'nominal' },
        { field: 'toolName', type: 'nominal', title: 'tool' },
        { field: 'tokens', type: 'quantitative', aggregate: 'sum', title: 'approx tokens' },
        { field: 'cost', type: 'nominal', title: `bar cost (${costMode})` },
      ],
    },
  };
  return { spec, rows };
}
