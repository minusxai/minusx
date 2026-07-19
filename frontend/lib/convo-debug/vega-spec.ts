/**
 * TurnBar[] → Vega-Lite HORIZONTAL stacked-bar spec + data rows for the
 * /debug viz: one row per turn (top→bottom), token length left→right on a
 * symlog scale (small bars stay visible; note that on a stacked bar a
 * log-family scale makes WITHIN-bar segment lengths non-linear — totals read
 * correctly, proportions don't).
 *
 * Segments are colored by `type · toolName` so different tools get different
 * colors, and consecutive same-label segments (e.g. two ReadFiles results)
 * are separated by a hairline stroke. No aggregation: each component row is
 * its own stacked segment (via the `detail` channel), keeping
 * barIndex/componentIndex on the mark datum for click-to-inspect.
 *
 * The spec deliberately omits `data`: the render pipeline injects the
 * reserved named dataset (`prepareVegaLiteSpec` → `data: {name:'main'}`) and
 * the rows are bound via `createVegaView(vegaSpec, rows, …)`.
 */
import type { BarComponent, ComponentType, TurnBar } from './types';

/** Fixed colors for the non-tool component types. */
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

/** Distinct hues assigned (deterministically, in domain order) to per-tool
 *  segment labels so each tool is tellable apart. Wraps past its length. */
const TOOL_PALETTE = [
  '#e74c3c', '#e67e22', '#f1c40f', '#d35400', '#ff7f50',
  '#c0392b', '#f39c12', '#e91e63', '#ff5722', '#ffb142',
  '#b33939', '#cd6133',
];

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

/** Color-domain label: tool-bearing components split out per tool. */
export function segmentLabel(component: Pick<BarComponent, 'type' | 'toolName'>): string {
  return component.toolName ? `${component.type} · ${component.toolName}` : component.type;
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

const BASE_TYPE_ORDER = Object.keys(COMPONENT_COLORS);

function domainRank(label: string): number {
  const base = label.split(' · ')[0];
  return BASE_TYPE_ORDER.indexOf(base);
}

function colorFor(label: string, toolLabelIndex: Map<string, number>): string {
  const [base, tool] = label.split(' · ');
  if (!tool) return COMPONENT_COLORS[base as ComponentType] ?? '#95a5a6';
  return TOOL_PALETTE[(toolLabelIndex.get(label) ?? 0) % TOOL_PALETTE.length];
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
      component: segmentLabel(component),
      toolName: component.toolName ?? '',
      tokens: component.tokens,
      cost: barCostLabel(bar, costMode),
      costMode,
    })),
  );

  // Deterministic domain: base-type order, then label; tool labels then get
  // sequential palette hues in that order.
  const domain = [...new Set(rows.map((r) => r.component))].sort(
    (a, b) => domainRank(a) - domainRank(b) || a.localeCompare(b),
  );
  const toolLabelIndex = new Map<string, number>();
  for (const label of domain) {
    if (label.includes(' · ')) toolLabelIndex.set(label, toolLabelIndex.size);
  }

  const spec: Record<string, unknown> = {
    // Hairline stroke so consecutive same-color segments (two results from
    // the same tool) stay visually separate blocks.
    mark: { type: 'bar', cursor: 'pointer', stroke: '#00000066', strokeWidth: 0.5 },
    encoding: {
      // HORIZONTAL: one row per turn (top→bottom), bars grow left→right.
      y: {
        field: 'bar',
        type: 'nominal',
        sort: { field: 'barIndex', op: 'min' },
        axis: { title: null },
      },
      // Symlog: keeps the tiny assistant bars visible next to a 20k-token
      // context bar and tolerates zeros (unlike pure log).
      x: {
        field: 'tokens',
        type: 'quantitative',
        stack: 'zero',
        scale: { type: 'symlog', constant: 100 },
        axis: { title: 'approx tokens (symlog scale)' },
      },
      detail: { field: 'componentIndex', type: 'quantitative' },
      color: {
        field: 'component',
        type: 'nominal',
        scale: { domain, range: domain.map((label) => colorFor(label, toolLabelIndex)) },
      },
      order: { field: 'componentIndex', type: 'quantitative' },
      tooltip: [
        { field: 'bar', type: 'nominal' },
        { field: 'component', type: 'nominal' },
        { field: 'tokens', type: 'quantitative', title: 'approx tokens' },
        { field: 'cost', type: 'nominal', title: `bar cost (${costMode})` },
      ],
    },
  };
  return { spec, rows };
}
