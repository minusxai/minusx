/**
 * Visualization Type Selector
 * Grouped chart type selector with category labels
 */

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/kit/tooltip';
import {
  LuTable2,
  LuChartLine,
  LuChartColumn,
  LuChartArea,
  LuChartScatter,
  LuFilter,
  LuChartPie,
  LuGrid3X3,
  LuTrendingUp,
  LuChartNoAxesColumn,
  LuChartNoAxesCombined,
  LuMapPinned,
  LuMap,
  LuHash,
  LuChartBar,
  LuChartCandlestick,
  LuChartColumnBig,
  LuBraces,
  LuBookMarked,
} from 'react-icons/lu';
import type { VizSettings } from '@/lib/types';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { immutableSet } from '@/lib/utils/immutable-collections';

/**
 * Everything the selector can offer: the classic vizSettings types plus V2-only
 * types (Vega-tier charts with no classic V1 equivalent — the `VizSettings['type']`
 * union is the frozen on-disk V1 format and never grows for them). V2-only entries
 * render solely when `includeV2Only` is set (the Vega panel); classic surfaces never
 * see them.
 */
export type SelectableVizType = VizSettings['type'] | 'heatmap' | 'boxplot' | 'histogram' | 'choropleth' | 'point_map' | 'custom';

interface VizTypeOption {
  type: SelectableVizType;
  icon: React.ReactNode;
  label: string;
  /** Only offered on the V2 (Vega) panel — no classic renderer exists. */
  v2Only?: boolean;
  /** Not a conversion target: clicking selects it in the UI without emitting a
   * spec change — the panel decides what "viewing" the entry means. */
  informational?: boolean;
  /** Explanation shown when an informational entry is hovered. */
  informationalReason?: string;
}

interface VizTypeGroup {
  label: string;
  types: VizTypeOption[];
}

const ALL_VIZ_GROUPS: VizTypeGroup[] = [
  {
    label: 'Basic',
    types: [
      { type: 'table', icon: <LuGrid3X3 size={16} />, label: 'Table' },
      { type: 'bar', icon: <LuChartColumn size={16} />, label: 'Bar' },
      { type: 'line', icon: <LuChartLine size={16} />, label: 'Line' },
      { type: 'area', icon: <LuChartArea size={16} />, label: 'Area' },
      { type: 'row', icon: <LuChartBar size={16} />, label: 'Row' },
      { type: 'scatter', icon: <LuChartScatter size={16} />, label: 'Scatter' },
      { type: 'pie', icon: <LuChartPie size={16} />, label: 'Pie' },
    ],
  },
  {
    label: 'Advanced',
    types: [
      { type: 'combo', icon: <LuChartNoAxesCombined size={16} />, label: 'Combo' },
      { type: 'funnel', icon: <LuFilter size={16} />, label: 'Funnel' },
      { type: 'waterfall', icon: <LuChartNoAxesColumn size={16} />, label: 'Waterfall' },
      // Radar and heatmap are NOT offered here: they ship as workspace recipe
      // FILES (seeded at the mode roots by the workspace template) and surface
      // as Workspace tiles instead. Saved charts keep rendering — the shipped
      // minusx/radar@1 registry entry and the rect→heatmap classification stay.
      // Candlestick is Lucide's closest glyph to a box-and-whisker plot.
      { type: 'boxplot', icon: <LuChartCandlestick size={16} />, label: 'Boxplot', v2Only: true },
      { type: 'histogram', icon: <LuChartColumnBig size={16} />, label: 'Histogram', v2Only: true },
    ],
  },
  {
    label: 'Analytic',
    types: [
      { type: 'pivot', icon: <LuTable2 size={16} />, label: 'Pivot' },
      { type: 'trend', icon: <LuTrendingUp size={16} />, label: 'Trend' },
      { type: 'single_value', icon: <LuHash size={16} />, label: 'Number' },
      // V2 analytic geo, authored as native-Vega recipes: choropleth (region
      // fill) + the coordinate map (points/bubbles/flows over a vector or street-tile
      // basemap). These supersede the legacy combined `geo` type, which is no longer
      // offered here (existing `geo` questions still render via the V1→V2 bridge).
      { type: 'choropleth', icon: <LuMap size={16} />, label: 'Choropleth', v2Only: true },
      // Coordinate map: points/bubbles, + flows when a destination is bound.
      { type: 'point_map', icon: <LuMapPinned size={16} />, label: 'Geo', v2Only: true },
      {
        type: 'custom', icon: <LuBraces size={16} />, label: 'Custom', v2Only: true,
        informational: true,
        informationalReason: 'Custom is selected automatically for agent-authored or unsupported specs. Ask the agent to customize.',
      },
    ],
  },
];

// Flat list for legacy horizontal/vertical orientations
const ALL_VIZ_TYPES: VizTypeOption[] = ALL_VIZ_GROUPS.flatMap(g => g.types);

const V2_ONLY_TYPES: ReadonlySet<SelectableVizType> = immutableSet(
  ALL_VIZ_TYPES.filter(t => t.v2Only).map(t => t.type),
);

/** Narrow a selector emission to the classic vizSettings union (drops V2-only types). */
export function isClassicVizType(type: SelectableVizType): type is VizSettings['type'] {
  return !V2_ONLY_TYPES.has(type);
}

interface VizTypeSelectorProps {
  value: SelectableVizType;
  onChange: (type: SelectableVizType) => void;
  orientation?: 'vertical' | 'horizontal' | 'grouped';
  /**
   * Types that fit the current data shape (semantic questions). Everything
   * stays clickable — recommended types render at full strength, the rest
   * dim slightly. Omit for no treatment (non-semantic contexts).
   */
  recommended?: ReadonlyArray<SelectableVizType>;
  /** Types shown but not selectable (e.g. not yet supported for Vega V2 charts). */
  disabledTypes?: ReadonlyArray<SelectableVizType>;
  /** Tooltip/title for disabled entries. */
  disabledReason?: string;
  /** Offer V2-only entries (heatmap, …) — set by the Vega panel only. */
  includeV2Only?: boolean;
  /**
   * Workspace/built-in recipe entries (resolved for the current folder) shown
   * as an extra "Workspace" group — grouped orientation only. Selection fires
   * `onRecipeSelect` with the entry's address, never `onChange`.
   */
  workspaceRecipes?: ReadonlyArray<{ name: string; description?: string; address: string }>;
  onRecipeSelect?: (address: string) => void;
  /** The active frozen recipe's address (highlights its Workspace tile). */
  activeRecipeAddress?: string | null;
}

export function VizTypeSelector({
  value,
  onChange,
  orientation = 'vertical',
  recommended,
  disabledTypes,
  disabledReason,
  includeV2Only = false,
  workspaceRecipes,
  onRecipeSelect,
  activeRecipeAddress,
}: VizTypeSelectorProps) {
  const { config } = useConfigs();
  const allowedVizTypes = config.allowedVizTypes;
  const offered = (types: VizTypeOption[]) =>
    types.filter(v =>
      (includeV2Only || !v.v2Only) &&
      (!allowedVizTypes || v.v2Only || (allowedVizTypes as readonly string[]).includes(v.type)));

  if (orientation === 'grouped') {
    const groups = ALL_VIZ_GROUPS
      .map(group => ({ ...group, types: offered(group.types) }))
      .filter(group => group.types.length > 0);

    const allTypes = groups.flatMap(g => g.types);

    return (
      <div className="mb-2 grid w-full grid-cols-5 gap-1 rounded-md bg-muted/50 p-2">
        {/* Workspace/built-in recipes: file-defined chart templates for this
            folder. A tile applies the recipe (auto-bound, frozen on save) via
            onRecipeSelect — the SelectableVizType union stays untouched. */}
        {workspaceRecipes?.map(({ name, description, address }) => {
          const isActive = activeRecipeAddress === address;
          return (
            <button
              key={`recipe:${address}`}
              type="button"
              className={`flex flex-col items-center justify-center gap-0.5 rounded-md py-1.5 transition-all duration-[120ms] ease-in-out ${
                isActive ? 'bg-[#16a085]/15 text-[#16a085]' : 'bg-transparent text-muted-foreground'
              } cursor-pointer hover:opacity-100 ${isActive ? 'hover:bg-[#16a085]/20' : 'hover:bg-muted hover:text-foreground'}`}
              onClick={() => onRecipeSelect?.(address)}
              aria-label={`Recipe ${name}`}
              aria-pressed={isActive}
              title={description || name}
            >
              <LuBookMarked size={16} />
              <span className={`max-w-full truncate font-mono text-[10px] leading-none ${isActive ? 'font-bold' : 'font-medium'}`}>
                {name}
              </span>
            </button>
          );
        })}
        {allTypes.map(({ type, icon, label, informational, informationalReason }) => {
          const isActive = value === type;
          const isRecommended = recommended?.includes(type) ?? false;
          // With recommendations present, the non-fitting types recede a
          // little (still clickable); the active pick never dims.
          const dimmed = !!recommended && !isRecommended && !isActive;
          const isDisabled = disabledTypes?.includes(type) ?? false;
          return (
            <button
              key={type}
              type="button"
              className={`flex flex-col items-center justify-center gap-0.5 rounded-md py-1.5 transition-all duration-[120ms] ease-in-out ${
                isActive
                  ? 'bg-[#16a085]/15 text-[#16a085]'
                  : 'bg-transparent text-muted-foreground'
              } ${
                isDisabled
                  ? 'cursor-not-allowed opacity-30'
                  : `cursor-pointer hover:opacity-100 ${isActive ? 'hover:bg-[#16a085]/20' : 'hover:bg-muted hover:text-foreground'} ${dimmed ? 'opacity-50' : 'opacity-100'}`
              }`}
              onClick={() => { if (!isDisabled) onChange(type); }}
              aria-label={label}
              data-recommended={isRecommended ? 'true' : undefined}
              aria-disabled={isDisabled}
              aria-pressed={isActive}
              data-informational-state={informational ? (isActive ? 'active' : 'inactive') : undefined}
              title={informational ? informationalReason : isDisabled ? disabledReason : undefined}
            >
              {icon}
              <span className={`font-mono text-[10px] leading-none ${isActive ? 'font-bold' : 'font-medium'}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // Legacy flat layout (horizontal / vertical)
  const vizTypes = offered(ALL_VIZ_TYPES);

  const isHorizontal = orientation === 'horizontal';

  return (
    <TooltipProvider>
      <div
        className={`flex h-full items-center gap-0.5 ${
          isHorizontal
            ? 'flex-row flex-wrap bg-transparent p-0'
            : 'flex-col bg-muted p-1.5 shadow-sm'
        }`}
      >
        {vizTypes.map(({ type, icon, label, informational, informationalReason }) => {
          const isActive = value === type;

          return (
            <Tooltip key={type}>
              <TooltipTrigger
                aria-label={label}
                onClick={() => onChange(type)}
                aria-pressed={isActive}
                data-informational-state={informational ? (isActive ? 'active' : 'inactive') : undefined}
                className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors ${
                  isActive
                    ? 'bg-[#16a085] text-white'
                    : 'bg-transparent text-foreground hover:bg-muted'
                }`}
              >
                {icon}
              </TooltipTrigger>
              <TooltipContent side={isHorizontal ? 'top' : 'left'}>
                {informationalReason ?? label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
