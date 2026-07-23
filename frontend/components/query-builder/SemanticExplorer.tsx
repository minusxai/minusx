'use client';

/**
 * SemanticExplorer — the semantic query surface (the GUI tab), PyGWalker/
 * ThoughtSpot style.
 *
 * TOP (never scrolls away):
 *  - the shelves first: what's currently selected — Metrics / Dimensions /
 *    Time / Filters chips (removable), plus the row limit;
 *  - then a compact strip: the model chip, the field search, validation, Run.
 * BELOW (fills the panel): the FULL field vocabulary of the current model in
 * two scrollable columns — Dimensions with Time beneath (neither list is
 * usually long) | Metrics — so the whole vocabulary is visible at once.
 *
 * Interaction is CLICK-TO-TOGGLE — no drag and drop. Every field has exactly
 * one home (dimension → Dimensions, metric → Metrics, temporal → Time), so a
 * click is unambiguous; dragging would add ceremony without choices.
 *
 * The search bar FILTERS the columns as you type (they shrink), and
 * additionally surfaces matching fields from OTHER authored models
 * (server search, POST /api/semantic-models {q}) — picking one switches the
 * model. With no model picked yet, the columns give way to the AUTHORED-MODEL
 * picker, so a fresh question can always start a semantic query and there is
 * never a blank screen. Per §2.4 the picker lists MODELS (with their primary
 * source as a subtitle) — never raw tables.
 *
 * Every edit compiles the spec to dialect SQL client-side
 * (compileSemanticQuery → irToSqlLocal) and emits `(spec, sql, viz)` — the viz
 * columns are implied by the spec (x = time else dimensions, y = metrics).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { LuPlay, LuPause, LuRefreshCw, LuSigma, LuTag, LuCalendarDays, LuSearch, LuTriangleAlert, LuX, LuCheck, LuLayers, LuListFilter, LuHash, LuFingerprint, LuDivide, LuArrowDownToLine, LuArrowUpToLine, LuPercent, LuSquareFunction } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { compileSemanticQuery, validateSemanticQuery, semanticAlias, timeDimensionsOf } from '@/lib/semantic/compile';
import { inferVizType } from '@/lib/semantic/infer-viz';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { searchFields, type SemanticFieldHit } from '@/lib/semantic/models-client';
import { VIEWS_SCHEMA, type SemanticAggregate, type SemanticMetricV2, type SemanticModelV2, type SemanticTimeGrain, type VizSettings } from '@/lib/types';
import type { SemanticQuerySpec, SemanticQueryFilter } from '@/lib/validation/atlas-schemas';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
import { AddChipButton } from './QueryChip';
import { Button } from '@/components/kit/button';
import { Input } from '@/components/kit/input';
import { cn } from '@/components/kit/cn';

const TIME_GRAINS: SemanticTimeGrain[] = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];

// Accent hexes (Chakra accent.* equivalents) + the color-mix helper for
// translucent tints (matches the PivotTableBody pattern).
const TEAL = '#16a085';
const PRIMARY = '#2980b9';
const SECONDARY = '#9b59b6';
const WARNING = '#f39c12';
const CYAN = '#1abc9c';
const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** One icon per aggregation — the metric list telegraphs HOW each aggregates. */
const AGG_ICONS: Record<SemanticAggregate, IconType> = {
  SUM: LuSigma,
  COUNT: LuHash,
  COUNT_DISTINCT: LuFingerprint,
  AVG: LuDivide,
  MIN: LuArrowDownToLine,
  MAX: LuArrowUpToLine,
};
const aggIcon = (agg?: SemanticAggregate): IconType => (agg && AGG_ICONS[agg]) || LuSigma;

/** Ratio/SQL metrics have no `agg` — their TYPE distinguishes them in the list. */
const metricIcon = (m: SemanticMetricV2): IconType =>
  m.type === 'aggregation' ? aggIcon(m.agg) : m.type === 'ratio' ? LuPercent : LuSquareFunction;

const OPERATORS: SemanticQueryFilter['operator'][] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL'];

/** The viz assignment implied by the spec. */
export interface SemanticVizAssignment {
  type: VizSettings['type'];
  xCols: string[];
  yCols: string[];
}

interface SemanticExplorerProps {
  /**
   * Every AUTHORED model visible at `path` on this connection — the picker's
   * list AND the vocabulary source, so picking one never waits on a fetch.
   */
  models: SemanticModelV2[];
  dialect: string;
  /** Context anchor + connection for the cross-model field search. */
  path: string;
  connectionName: string;
  /** Persisted spec from content.semanticQuery, if any. */
  value: SemanticQuerySpec | null | undefined;
  /** Emits the edited spec, the SQL compiled from it, and the implied viz. */
  onChange: (spec: SemanticQuerySpec, sql: string, viz: SemanticVizAssignment) => void;
  onExecute?: () => void;
  isExecuting?: boolean;
  /** Auto-run state, owned by the parent (undefined = no auto-run support). */
  autoRun?: boolean;
  onToggleAutoRun?: () => void;
}

/** How a model's primary is addressed in SQL — and subtitled in the picker. */
const primaryRef = (m: SemanticModelV2): { table: string; schema?: string } =>
  m.primary.kind === 'table'
    ? { table: m.primary.table, ...(m.primary.schema ? { schema: m.primary.schema } : {}) }
    : { table: m.primary.view, schema: VIEWS_SCHEMA };

const primaryLabel = (m: SemanticModelV2): string => {
  const ref = primaryRef(m);
  return ref.schema ? `${ref.schema}.${ref.table}` : ref.table;
};

/**
 * The seed spec for a picked model: `model` is the AUTHORED NAME (what the
 * compiler and the stored `content.semanticQuery` resolve against), and
 * table/schema carry its primary so scoped reloads find it again.
 */
const specForModel = (m: SemanticModelV2): SemanticQuerySpec => ({
  model: m.name,
  ...primaryRef(m),
  metrics: [],
  dimensions: [],
});

/** Everything selectable into the Metrics shelf. */
type MetricItem = { name: string; icon: IconType; tag?: string };

const metricItemsOf = (m: SemanticModelV2): MetricItem[] =>
  m.metrics.map((me): MetricItem => ({
    name: me.name,
    icon: metricIcon(me),
    tag: me.type === 'aggregation' ? me.agg : me.type,
  }));

const vizOf = (spec: SemanticQuerySpec): SemanticVizAssignment => ({
  type: inferVizType(spec),
  xCols: [
    ...(spec.timeGrain ? [spec.timeGrain.toLowerCase()] : []),
    ...spec.dimensions.map(semanticAlias),
  ],
  yCols: spec.metrics.map(semanticAlias),
});

const matches = (q: string, name: string) => {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((t) => name.toLowerCase().includes(t));
};

export function SemanticExplorer({
  models,
  dialect,
  path,
  connectionName,
  value,
  onChange,
  onExecute,
  isExecuting = false,
  autoRun,
  onToggleAutoRun,
}: SemanticExplorerProps) {
  const [spec, setSpec] = useState<SemanticQuerySpec | null>(() => value ?? null);
  const [browsingModels, setBrowsingModels] = useState(false);
  const [query, setQuery] = useState('');
  const [otherHits, setOtherHits] = useState<SemanticFieldHit[]>([]);
  const searchSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reconcile EXTERNAL spec changes (header Cancel, agent edits, undo): when
  // the value prop changes and it isn't just our own last edit echoing back
  // through content, adopt it — otherwise the shelves keep showing a
  // selection the query no longer has. Local-only intermediate states (a
  // freshly picked model before its default measure lands) are safe: the
  // value prop hasn't changed then, so this never clobbers them.
  const lastEmittedJson = useRef<string | null>(null);
  const prevValueJson = useRef<string>(JSON.stringify(value ?? null));
  useEffect(() => {
    const json = JSON.stringify(value ?? null);
    if (json === prevValueJson.current) return; // prop identity churn, same spec
    prevValueJson.current = json;
    if (json === lastEmittedJson.current) return; // our own edit, persisted and echoed
    setSpec(value ?? null);
    setBrowsingModels(false);
  }, [value]);

  const model = spec ? models.find((m) => m.name === spec.model) : undefined;
  const issues = spec && model ? validateSemanticQuery(spec, model) : [];

  const apply = useCallback((next: SemanticQuerySpec, nextModel: SemanticModelV2) => {
    setSpec(next);
    if (validateSemanticQuery(next, nextModel).length > 0) return;
    try {
      const sql = irToSqlLocal(compileSemanticQuery(next, nextModel), dialect);
      lastEmittedJson.current = JSON.stringify(next);
      onChange(next, sql, vizOf(next));
    } catch (err) {
      console.error('[SemanticExplorer] compile failed:', err);
    }
  }, [dialect, onChange]);

  const update = useCallback((updates: Partial<SemanticQuerySpec>) => {
    if (spec && model) apply({ ...spec, ...updates }, model);
  }, [apply, spec, model]);

  // --- toggles ----------------------------------------------------------------

  const toggleMetric = useCallback((name: string) => {
    if (!spec || !model) return;
    update({
      metrics: spec.metrics.includes(name)
        ? spec.metrics.filter((m) => m !== name)
        : [...spec.metrics, name],
    });
  }, [spec, model, update]);

  const toggleDimension = useCallback((name: string) => {
    if (!spec || !model) return;
    update({
      dimensions: spec.dimensions.includes(name)
        ? spec.dimensions.filter((d) => d !== name)
        : [...spec.dimensions, name],
    });
  }, [spec, model, update]);

  // Any PRIMARY temporal dimension can be the time axis (the FIRST is the
  // model default). Clicking the active one clears it; clicking another
  // temporal column moves the axis there.
  const toggleTime = useCallback((column?: string) => {
    if (!spec || !model) return;
    const defaultAxis = timeDimensionsOf(model)[0]?.column;
    const target = column ?? defaultAxis;
    if (!target) return;
    const effective = spec.timeColumn ?? defaultAxis;
    if (spec.timeGrain && effective === target) {
      update({ timeGrain: undefined, timeColumn: undefined });
    } else {
      update({
        timeGrain: spec.timeGrain ?? 'MONTH',
        timeColumn: target === defaultAxis ? undefined : target,
      });
    }
  }, [spec, model, update]);

  // A freshly picked (or detected/persisted) model: give the spec its first
  // metric so the query executes the moment it's picked.
  useEffect(() => {
    if (!spec || spec.metrics.length > 0) return;
    const loaded = models.find((m) => m.name === spec.model);
    if (!loaded) return;
    const first = metricItemsOf(loaded)[0];
    if (first) Promise.resolve().then(() => apply({ ...spec, metrics: [first.name] }, loaded));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, spec?.model, spec?.metrics.length]);

  // --- cross-model search (feeds the "Other models" strip) --------------------

  const runSearch = useCallback((q: string) => {
    setQuery(q);
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setOtherHits([]); return; }
    searchTimer.current = setTimeout(async () => {
      const mine = ++searchSeq.current;
      const results = await searchFields(path, connectionName, q);
      if (mine === searchSeq.current) setOtherHits(results);
    }, 250);
  }, [path, connectionName]);

  const pickModel = useCallback((picked: SemanticModelV2) => {
    setSpec(specForModel(picked));
    setBrowsingModels(false);
    setQuery('');
    setOtherHits([]);
  }, []);

  const pickOtherHit = useCallback((hit: SemanticFieldHit) => {
    setSpec({
      model: hit.model,
      table: hit.table,
      ...(hit.schema ? { schema: hit.schema } : {}),
      metrics: hit.kind === 'dimension' ? [] : [hit.name],
      dimensions: hit.kind === 'dimension' ? [hit.name] : [],
    });
    setBrowsingModels(false);
    setQuery('');
    setOtherHits([]);
  }, []);

  // --- field vocabulary, split by home column ----------------------------------

  // The effective time axis (spec.timeColumn overrides the model default —
  // the FIRST primary temporal dimension).
  const temporalDims = model ? timeDimensionsOf(model) : [];
  const effectiveTimeColumn = spec?.timeColumn ?? temporalDims[0]?.column;
  const timeLabel = temporalDims.find((d) => d.column === effectiveTimeColumn)?.name ?? 'Time';

  const visibleMetrics = model ? metricItemsOf(model).filter((m) => matches(query, m.name)) : [];
  const visibleTemporal = temporalDims.filter((d) => matches(query, d.name));
  const visibleDimensions = model
    ? model.dimensions.filter((d) => !(d.temporal && d.source === 'primary') && matches(query, d.name))
    : [];
  // Cross-table hits, minus the current model's own fields (already listed).
  const foreignHits = otherHits.filter((h) => h.model !== spec?.model).slice(0, 20);

  const fieldRow = (label: string, assigned: boolean, accent: string, icon: React.ReactNode, onClick: () => void, ariaLabel: string, tag?: string) => (
    <button
      key={ariaLabel}
      aria-label={ariaLabel}
      type="button"
      className="flex w-full shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md border border-[var(--fr-border)] bg-[var(--fr-bg)] px-2 py-1 text-left transition-[background] duration-100 ease-in hover:bg-[var(--fr-hover)]"
      style={{
        '--fr-border': assigned ? accent : 'transparent',
        '--fr-bg': assigned ? mix(accent, 10) : 'transparent',
        '--fr-hover': assigned ? mix(accent, 15) : 'var(--muted)',
      } as React.CSSProperties}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{label}</span>
      {tag && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{tag}</span>}
      {assigned && <span className="flex shrink-0 items-center"><LuCheck size={12} color={accent} /></span>}
    </button>
  );

  // --- top strip: table chip + search + validation + run ------------------------

  const topStrip = (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      {spec && (
        <button
          type="button"
          aria-label="Change model"
          className={cn(
            'flex max-w-[200px] shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 hover:bg-muted',
            browsingModels ? 'bg-muted' : 'bg-card',
          )}
          onClick={() => setBrowsingModels((b) => !b)}
          title="Pick a different semantic model (starts a fresh query)"
        >
          <LuLayers size={12} color={TEAL} className="shrink-0" />
          <span className="truncate font-mono text-xs font-semibold">{spec.model}</span>
          <span className="font-mono text-[10px] text-muted-foreground">▾</span>
        </button>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-2">
        <LuSearch size={13} className="shrink-0 text-muted-foreground" />
        <Input
          aria-label="Semantic field search"
          className="h-6 min-w-0 border-none bg-transparent px-0 font-mono text-xs shadow-none focus-visible:border-transparent focus-visible:ring-0"
          placeholder={model && !browsingModels ? 'Filter fields…' : 'Search models and fields…'}
          value={query}
          onChange={(e) => runSearch(e.target.value)}
        />
      </div>
      {spec && issues.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 text-[#f39c12]" title={issues[0]}>
          <LuTriangleAlert size={13} />
          <span className="max-w-[140px] truncate font-mono text-[10px]">{issues[0]}</span>
        </div>
      )}
      {spec && onToggleAutoRun && (
        <button
          type="button"
          aria-label="Toggle auto-run"
          onClick={onToggleAutoRun}
          className={cn(
            'flex shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 py-1',
            autoRun
              ? 'border-[#16a085] bg-[#16a085]/10 text-[#16a085] hover:bg-[#16a085]/15'
              : 'border-border bg-transparent text-muted-foreground hover:bg-muted',
          )}
          title={autoRun ? 'Auto-run is on: every edit executes automatically' : 'Auto-run is off: use Run'}
        >
          {autoRun ? <LuRefreshCw size={11} /> : <LuPause size={11} />}
          <span className="font-mono text-[10px] font-semibold">Auto</span>
        </button>
      )}
      {spec && onExecute && (
        <Button
          aria-label="Execute semantic query"
          onClick={onExecute}
          size="xs"
          className="shrink-0 bg-[#16a085] px-3 font-mono font-semibold text-white hover:bg-[#16a085] hover:opacity-90"
          disabled={isExecuting || issues.length > 0}
        >
          {isExecuting ? (
            <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <LuPlay size={12} fill="currentColor" />
          )}
          Run
        </Button>
      )}
    </div>
  );

  // --- shelves: the current selection, always visible on top --------------------

  // Fixed-width labels line the shelves up into a label column — one shelf
  // per line reads far calmer than a single wrapped row.
  const shelfLabel = (label: string, empty: boolean) => (
    <span
      className={cn(
        'min-w-[80px] shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground',
        empty ? 'opacity-45' : 'opacity-100',
      )}
    >
      {label}
    </span>
  );

  const shelves = spec && (
    <div aria-label="Semantic shelves" className="shrink-0 border-b border-border bg-card px-3 py-2">
      <div className="flex flex-col items-stretch gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {shelfLabel('Metrics', spec.metrics.length === 0)}
          {spec.metrics.map((name) => (
            <ShelfChip
              key={name}
              label={`Metrics chip: ${name}`}
              accent={PRIMARY}
              onRemove={spec.metrics.length > 1 ? () => update({ metrics: spec.metrics.filter((m) => m !== name) }) : undefined}
            >
              <span className="font-mono text-xs">{name}</span>
            </ShelfChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {shelfLabel('Dimensions', spec.dimensions.length === 0)}
          {spec.dimensions.map((name) => (
            <ShelfChip
              key={name}
              label={`Dimensions chip: ${name}`}
              accent={WARNING}
              onRemove={() => update({ dimensions: spec.dimensions.filter((d) => d !== name) })}
            >
              <span className="font-mono text-xs">{name}</span>
            </ShelfChip>
          ))}
        </div>
        {temporalDims.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {shelfLabel('Time', !spec.timeGrain)}
            {spec.timeGrain && (
              <ShelfChip label={`Time chip: ${timeLabel}`} accent={SECONDARY} onRemove={() => update({ timeGrain: undefined })}>
                <span className="font-mono text-xs">{timeLabel}</span>
                <select
                  aria-label="Time grain"
                  value={spec.timeGrain ?? 'MONTH'}
                  onChange={(e) => update({ timeGrain: e.target.value as SemanticTimeGrain })}
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: '11px', fontFamily: 'var(--font-jetbrains-mono), monospace', background: 'transparent', color: 'inherit', border: 'none', outline: 'none', cursor: 'pointer' }}
                >
                  {TIME_GRAINS.map((g) => <option key={g} value={g}>per {g}</option>)}
                </select>
              </ShelfChip>
            )}
          </div>
        )}
        {/* Filters and Limit share the last line — Limit hugs the right edge. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {shelfLabel('Filters', (spec.filters ?? []).length === 0)}
          {(spec.filters ?? []).map((f, idx) => (
            <SemanticFilterPicker
              key={`${f.dimension}-${f.operator}-${filterValueString(f)}-${idx}`}
              dimensions={model ? model.dimensions.map((d) => d.name) : [f.dimension]}
              initial={f}
              onSubmit={(filter) => update({ filters: (spec.filters ?? []).map((prev, i) => (i === idx ? filter : prev)) })}
              trigger={(openEditor) => (
                // The div is the popover anchor: PopoverTrigger asChild needs a
                // ref-forwarding element, which the plain ShelfChip fn is not —
                // without it the popover loses its anchor and renders top-left.
                <div className="inline-flex">
                  <ShelfChip
                    label={`Filter chip: ${f.dimension}`}
                    accent={CYAN}
                    onClick={openEditor}
                    onRemove={() => update({ filters: (spec.filters ?? []).filter((_, i) => i !== idx) })}
                  >
                    <span className="font-mono text-xs">
                      {f.operator === 'IS NULL' || f.operator === 'IS NOT NULL'
                        ? `${f.dimension} ${f.operator}`
                        : `${f.dimension} ${f.operator} ${Array.isArray(f.value) ? `(${f.value.join(', ')})` : String(f.value ?? '')}`}
                    </span>
                  </ShelfChip>
                </div>
              )}
            />
          ))}
          {model && (
            <SemanticFilterPicker
              dimensions={model.dimensions.map((d) => d.name)}
              onSubmit={(filter) => update({ filters: [...(spec.filters ?? []), filter] })}
              trigger={(openEditor) => (
                <div aria-label="Add semantic filter">
                  <AddChipButton onClick={openEditor} variant="filter" />
                </div>
              )}
            />
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {/* Inline label (not shelfLabel): the right-hugging Limit must not carry the
                80px label-column width. Opacity keys on the limit being set. */}
            <span
              className={cn(
                'shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground',
                spec.limit ? 'opacity-100' : 'opacity-45',
              )}
            >
              Limit
            </span>
            <Input
              aria-label="Semantic row limit"
              type="number"
              className="h-6 w-16 px-1.5 font-mono text-xs"
              value={spec.limit ?? ''}
              placeholder="1000"
              onChange={(e) => {
                const limit = parseInt(e.target.value, 10);
                update({ limit: isNaN(limit) || limit <= 0 ? undefined : limit });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  // --- field columns -------------------------------------------------------------

  // A labeled field section with a sticky header; the parent column scrolls.
  // Non-first sections (Time, under Dimensions) get a top border to separate
  // them from the rows above.
  const fieldSection = (
    ariaLabel: string,
    label: string,
    icon: React.ReactNode,
    count: number,
    rows: React.ReactNode,
    emptyText: string,
    first = true,
  ) => (
    <div aria-label={ariaLabel} className="flex min-w-0 flex-col">
      <div
        className={cn(
          'sticky top-0 z-[1] flex shrink-0 items-center gap-1.5 border-b border-border bg-muted px-2.5 py-1.5',
          !first && 'border-t border-border',
        )}
      >
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{count}</span>
      </div>
      <div className="flex flex-col gap-1 px-1.5 py-1.5">
        {count === 0
          ? <span className="px-1 py-1 font-mono text-[10px] text-muted-foreground">{emptyText}</span>
          : rows}
      </div>
    </div>
  );

  // Two columns: Dimensions with Time beneath (neither list is usually long),
  // Measures on the right.
  const columns = model && spec && (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-h-0 min-w-0 overflow-y-auto border-r border-border">
        {fieldSection(
          'Dimensions column', 'Dimensions',
          <LuTag size={11} color={WARNING} />,
          visibleDimensions.length,
          visibleDimensions.map((d) => fieldRow(
            d.name,
            spec.dimensions.includes(d.name),
            WARNING,
            <LuTag size={12} color={WARNING} />,
            () => toggleDimension(d.name),
            `Field dimension: ${d.name}`,
          )),
          query ? 'No matches' : 'No dimensions',
        )}
        {fieldSection(
          'Time column', 'Time',
          <LuCalendarDays size={11} color={SECONDARY} />,
          visibleTemporal.length,
          <>
            {visibleTemporal.map((d) => fieldRow(
              d.name,
              (!!spec.timeGrain && effectiveTimeColumn === d.column) || spec.dimensions.includes(d.name),
              SECONDARY,
              <LuCalendarDays size={12} color={SECONDARY} />,
              () => (spec.dimensions.includes(d.name) ? toggleDimension(d.name) : toggleTime(d.column)),
              `Field time: ${d.name}`,
            ))}
          </>,
          query ? 'No matches' : 'No time fields',
          false,
        )}
      </div>
      <div className="min-h-0 min-w-0 overflow-y-auto">
        {fieldSection(
          'Metrics column', 'Metrics',
          <LuSigma size={11} color={PRIMARY} />,
          visibleMetrics.length,
          visibleMetrics.map((m) => {
            const MetricRowIcon = m.icon;
            return fieldRow(
              m.name,
              spec.metrics.includes(m.name),
              PRIMARY,
              <MetricRowIcon size={12} color={PRIMARY} />,
              () => toggleMetric(m.name),
              `Field metric: ${m.name}`,
              m.tag,
            );
          }),
          query ? 'No matches' : 'No metrics',
        )}
      </div>
    </div>
  );

  // --- model picker (no model yet, or explicitly changing model) -----------------
  // §2.4: the browse surface lists MODELS — never raw tables. Each row is the
  // authored NAME (what the spec/compiler resolve against) subtitled with the
  // primary source it reads and its description.

  const visibleModels = models.filter((m) => matches(query, `${m.name} ${m.description ?? ''}`));

  const modelPicker = (
    <div aria-label="Semantic model picker" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
      {spec && !model && (
        <span aria-label="semantic-model-unavailable" className="px-1 pb-1 font-mono text-[10px] text-[#f39c12]">
          &quot;{spec.model}&quot; isn&apos;t available here — pick a model below
        </span>
      )}
      <div className="flex items-center gap-1.5 pb-1">
        <LuLayers size={12} color={SECONDARY} />
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Semantic models</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{visibleModels.length}</span>
      </div>
      {visibleModels.length === 0 ? (
        <span className="px-1 py-1 font-mono text-[10px] text-muted-foreground">No models match</span>
      ) : visibleModels.map((m) => (
        <button
          key={m.name}
          aria-label={`Pick model: ${m.name}`}
          type="button"
          className="flex w-full shrink-0 cursor-pointer select-none items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-[background] duration-100 ease-in hover:bg-muted"
          onClick={() => pickModel(m)}
        >
          <LuLayers size={14} color={SECONDARY} className="shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-mono text-xs font-semibold">{m.name}</span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {primaryLabel(m)}{m.description ? ` · ${m.description}` : ''}
            </span>
          </div>
        </button>
      ))}
    </div>
  );

  // --- cross-model search hits (pinned under the columns) -------------------------

  const otherTablesStrip = foreignHits.length > 0 && (
    <div className="max-h-[160px] shrink-0 overflow-y-auto border-t border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 pb-1.5">
        <LuListFilter size={11} className="text-muted-foreground" />
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Other models</span>
      </div>
      <div className="flex flex-col gap-1">
        {foreignHits.map((h) => (
          <button
            key={`${h.kind}:${h.model}:${h.name}`}
            aria-label={`Other model field ${h.kind}: ${h.name} (${h.model})`}
            type="button"
            className="flex w-full shrink-0 items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-left hover:bg-muted"
            onClick={() => pickOtherHit(h)}
          >
            {h.kind === 'dimension'
              ? <LuTag size={12} color={WARNING} />
              : <LuSigma size={12} color={PRIMARY} />}
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{h.name}</span>
            <span className="max-w-[90px] truncate font-mono text-[10px] text-muted-foreground">{h.model}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // M5 (Semantic_Model_v2.md §2.7): models are AUTHORED, not derived. `models`
  // is the FULL authored set for this connection (fetched unscoped), so an
  // empty one genuinely means "none authored" — point at where they're made.
  // Anything else lands on the picker below, never on this state.
  if (models.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-6 py-8">
        <LuLayers size={20} className="text-muted-foreground" />
        <p
          aria-label="semantic-models-empty-state"
          className="max-w-[360px] text-center font-mono text-xs text-muted-foreground"
        >
          No semantic models yet — create one in the knowledge base (context) editor
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!browsingModels && shelves}
      {topStrip}
      {/* No spec, explicitly changing model, or a spec naming a model that no
          longer exists → the picker. Never a dead "Loading …" screen. */}
      {!spec || browsingModels || !model ? modelPicker : columns}
      {otherTablesStrip}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function ShelfChip({ label, accent = 'var(--border)', onRemove, onClick, children }: {
  label: string; accent?: string; onRemove?: () => void; onClick?: () => void; children: React.ReactNode;
}) {
  return (
    <div
      aria-label={label}
      className={cn(
        'flex select-none items-center gap-1.5 rounded-md border border-[var(--sc-border)] bg-[var(--sc-bg)] px-2 py-0.5',
        onClick && 'cursor-pointer hover:bg-[var(--sc-hover)]',
      )}
      style={{
        '--sc-bg': mix(accent, 8),
        '--sc-border': mix(accent, 25),
        '--sc-hover': mix(accent, 15),
      } as React.CSSProperties}
      onClick={onClick}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label.split(': ')[1]} from ${label.split(' chip')[0]}`}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove(); }}
          className="shrink-0 text-muted-foreground hover:text-[#c0392b]"
        >
          <LuX size={12} />
        </button>
      )}
    </div>
  );
}

/** String form of a filter's value, for the editor input. */
const filterValueString = (f?: SemanticQueryFilter): string =>
  f?.value === undefined ? '' : Array.isArray(f.value) ? f.value.join(', ') : String(f.value);

/**
 * Filter editor popover — both flows: ADD (empty, dimension → operator →
 * value) and EDIT-IN-PLACE (`initial` set: opens prefilled on the clicked
 * chip, dimension fixed). The trigger render-prop receives the open() call.
 */
function SemanticFilterPicker({ dimensions, initial, trigger, onSubmit }: {
  dimensions: string[];
  initial?: SemanticQueryFilter;
  trigger: (open: () => void) => React.ReactNode;
  onSubmit: (filter: SemanticQueryFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dimension, setDimension] = useState(initial?.dimension ?? '');
  const [operator, setOperator] = useState<SemanticQueryFilter['operator']>(initial?.operator ?? '=');
  const [value, setValue] = useState(() => filterValueString(initial));

  const close = () => {
    setOpen(false);
    setDimension(initial?.dimension ?? '');
    setOperator(initial?.operator ?? '=');
    setValue(filterValueString(initial));
  };
  const needsValue = operator !== 'IS NULL' && operator !== 'IS NOT NULL';

  const submit = () => {
    if (!dimension || (needsValue && !value.trim())) return;
    const parsed: SemanticQueryFilter['value'] = !needsValue ? undefined
      : operator === 'IN' ? value.split(',').map((v) => v.trim()).filter(Boolean)
      : value.trim() !== '' && !isNaN(Number(value)) ? Number(value)
      : value;
    onSubmit({ dimension, operator, ...(parsed !== undefined ? { value: parsed } : {}) });
    close();
  };

  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => { if (!details.open) close(); else setOpen(true); }}
      trigger={trigger(() => setOpen(true))}
      width="300px"
      padding={3}
    >
      <div className="flex flex-col gap-2">
        {!dimension ? (
          <>
            <PickerHeader>Filter dimension</PickerHeader>
            <PickerList maxH="220px" searchable searchPlaceholder="Search dimensions...">
              {(query) => dimensions
                .filter((d) => !query || d.toLowerCase().includes(query.toLowerCase()))
                .map((d) => (
                  <PickerItem key={d} aria-label={`Filter dimension ${d}`} onClick={() => setDimension(d)}>
                    {d}
                  </PickerItem>
                ))}
            </PickerList>
          </>
        ) : (
          <>
            <p className="font-mono text-xs font-semibold">{dimension}</p>
            <div className="flex flex-wrap items-center gap-1">
              {OPERATORS.map((op) => (
                <Button
                  key={op}
                  aria-label={`Semantic operator ${op}`}
                  size="xs"
                  variant={operator === op ? 'default' : 'outline'}
                  className="h-5 px-1.5 font-mono text-[10px]"
                  onClick={() => setOperator(op)}
                >
                  {op}
                </Button>
              ))}
            </div>
            {needsValue && (
              <Input
                aria-label="Semantic filter value"
                className="h-8 font-mono text-xs"
                placeholder={operator === 'IN' ? 'a, b, c' : 'value'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                autoFocus
              />
            )}
            <div className="flex items-center justify-end gap-2">
              <Button size="xs" variant="outline" className="h-5 px-1.5 text-[10px]" onClick={close}>Cancel</Button>
              <Button
                aria-label="Apply semantic filter"
                size="xs"
                className="h-5 bg-[#16a085] px-1.5 text-[10px] text-white hover:bg-[#16a085]/90"
                onClick={submit}
                disabled={!dimension || (needsValue && !value.trim())}
              >
                Apply
              </Button>
            </div>
          </>
        )}
      </div>
    </PickerPopover>
  );
}
