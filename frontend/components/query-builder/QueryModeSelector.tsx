/**
 * QueryModeSelector - Segmented control for Semantic, SQL, and Viz modes.
 *
 * Semantic is the curated query surface (only shown when the active context
 * defines semantic models for the connection; only enabled when the current
 * SQL reliably detects as a semantic query, or is empty). SQL is always
 * available. Viz configures the chart.
 */

'use client';

import { LuCode, LuChartColumn, LuSparkles } from 'react-icons/lu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';
import { cn } from '@/components/kit/cn';

export type QueryTab = 'semantic' | 'sql' | 'viz';

interface QueryModeSelectorProps {
  mode: QueryTab;
  /** Whether this source family is active (false leaves all tabs visually unselected). */
  active?: boolean;
  onModeChange: (mode: QueryTab) => void;
  /** Whether the Semantic tab is shown at all (context defines models). Default false. */
  showSemanticTab?: boolean;
  /** Whether the Semantic tab is usable (query detects as semantic / is empty). Default true. */
  canUseSemantic?: boolean;
  semanticError?: string;
  /** Whether the Viz tab is shown at all (container concern). Default true. */
  showVizTab?: boolean;
  /** Whether the Viz tab is usable — false greys it out (e.g. no query results yet). Default true. */
  canUseViz?: boolean;
  vizError?: string;
  /** 'md' (default, page) or 'sm' (compact — notebook cell toolbar). */
  size?: 'sm' | 'md';
}

const TAB_ITEMS: Array<{ key: QueryTab; label: string; gated?: 'semantic' | 'viz'; Icon: typeof LuCode }> = [
  { key: 'semantic', label: 'Semantic', Icon: LuSparkles, gated: 'semantic' },
  { key: 'sql', label: 'SQL', Icon: LuCode },
  { key: 'viz', label: 'Viz', Icon: LuChartColumn, gated: 'viz' },
];

export function QueryModeSelector({
  mode,
  active = true,
  onModeChange,
  showSemanticTab = false,
  canUseSemantic = true,
  semanticError,
  showVizTab = true,
  canUseViz = true,
  vizError,
  size = 'md',
}: QueryModeSelectorProps) {
  const tabs = TAB_ITEMS
    .filter(t => (t.key === 'viz' ? showVizTab : true))
    .filter(t => (t.key === 'semantic' ? showSemanticTab : true));
  const sm = size === 'sm';

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center rounded-md bg-muted p-[2px]">
        {tabs.map(({ key, label, gated, Icon }) => {
          const isActive = active && mode === key;
          const isDisabled =
            (gated === 'semantic' && !canUseSemantic) || (gated === 'viz' && !canUseViz);
          const tooltip =
            gated === 'semantic'
              ? (canUseSemantic ? 'Query curated metrics and dimensions' : (semanticError || 'This SQL is not expressible with the semantic model'))
            : gated === 'viz' ? (vizError || (canUseViz ? 'Configure chart' : 'Run the query to configure a chart'))
            : undefined;

          const button = (
            <button
              key={tooltip ? undefined : key}
              type="button"
              aria-label={label}
              aria-disabled={isDisabled}
              className={cn(
                'flex flex-1 items-center justify-center gap-1 rounded-sm transition-all duration-150',
                sm ? 'px-2 py-0.5' : 'px-3 py-1.5',
                isActive
                  ? 'bg-[#16a085]/90 text-white'
                  : 'bg-transparent text-muted-foreground',
                isDisabled
                  ? 'cursor-not-allowed opacity-50'
                  : cn('cursor-pointer', isActive ? 'hover:text-white' : 'hover:text-foreground'),
              )}
              onClick={() => !isDisabled && onModeChange(key)}
            >
              <Icon size={sm ? 11 : 13} />
              <span className={cn('font-mono font-semibold', sm ? 'text-[11px]' : 'text-xs')}>{label}</span>
            </button>
          );

          if (!tooltip) return button;

          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="top">{tooltip}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
