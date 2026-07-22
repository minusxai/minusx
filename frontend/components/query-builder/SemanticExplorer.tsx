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
import { Box, VStack, HStack, Text, Button, Input, Icon, Grid } from '@chakra-ui/react';
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

const TIME_GRAINS: SemanticTimeGrain[] = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];

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
    <HStack
      key={ariaLabel}
      aria-label={ariaLabel}
      as="button"
      gap={1.5} px={2} py={1}
      bg={assigned ? `${accent}/10` : 'transparent'}
      borderRadius="md" border="1px solid"
      borderColor={assigned ? accent : 'transparent'}
      cursor="pointer"
      _hover={{ bg: assigned ? `${accent}/15` : 'bg.muted' }}
      onClick={onClick}
      userSelect="none"
      width="100%"
      textAlign="left"
      flexShrink={0}
      transition="background 0.1s ease"
    >
      {icon}
      <Text fontSize="xs" fontFamily="mono" truncate flex={1}>{label}</Text>
      {tag && <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{tag}</Text>}
      {assigned && <Box flexShrink={0}><LuCheck size={12} color={`var(--chakra-colors-${accent.replace('.', '-')})`} /></Box>}
    </HStack>
  );

  // --- top strip: table chip + search + validation + run ------------------------

  const topStrip = (
    <HStack px={3} py={2} gap={2} flexShrink={0} borderBottom="1px solid" borderColor="border.muted">
      {spec && (
        <HStack
          as="button"
          aria-label="Change model"
          gap={1.5} px={2} py={1}
          borderRadius="md" border="1px solid" borderColor="border.muted"
          bg={browsingModels ? 'bg.muted' : 'bg.surface'}
          _hover={{ bg: 'bg.muted' }}
          onClick={() => setBrowsingModels((b) => !b)}
          flexShrink={0}
          maxW="200px"
          title="Pick a different semantic model (starts a fresh query)"
        >
          <Icon as={LuLayers} boxSize={3} color="accent.teal" flexShrink={0} />
          <Text fontSize="xs" fontFamily="mono" fontWeight="600" truncate>{spec.model}</Text>
          <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">▾</Text>
        </HStack>
      )}
      <HStack gap={1.5} px={2} flex={1} minW={0} bg="bg.surface" borderRadius="md" border="1px solid" borderColor="border.muted">
        <LuSearch size={13} color="var(--chakra-colors-fg-subtle)" />
        <Input
          aria-label="Semantic field search"
          variant="subtle"
          bg="transparent"
          size="xs"
          fontFamily="mono"
          fontSize="xs"
          border="none"
          placeholder={model && !browsingModels ? 'Filter fields…' : 'Search models and fields…'}
          value={query}
          onChange={(e) => runSearch(e.target.value)}
        />
      </HStack>
      {spec && issues.length > 0 && (
        <HStack gap={1} color="orange.400" flexShrink={0} title={issues[0]}>
          <LuTriangleAlert size={13} />
          <Text fontSize="2xs" fontFamily="mono" maxW="140px" truncate>{issues[0]}</Text>
        </HStack>
      )}
      {spec && onToggleAutoRun && (
        <HStack
          as="button"
          aria-label="Toggle auto-run"
          onClick={onToggleAutoRun}
          gap={1} px={2} py={1}
          borderRadius="md" border="1px solid"
          borderColor={autoRun ? 'accent.teal' : 'border.muted'}
          bg={autoRun ? 'accent.teal/10' : 'transparent'}
          color={autoRun ? 'accent.teal' : 'fg.subtle'}
          cursor="pointer"
          _hover={{ bg: autoRun ? 'accent.teal/15' : 'bg.muted' }}
          flexShrink={0}
          title={autoRun ? 'Auto-run is on: every edit executes automatically' : 'Auto-run is off: use Run'}
        >
          {autoRun ? <LuRefreshCw size={11} /> : <LuPause size={11} />}
          <Text fontSize="2xs" fontFamily="mono" fontWeight="600">Auto</Text>
        </HStack>
      )}
      {spec && onExecute && (
        <Button
          aria-label="Execute semantic query"
          onClick={onExecute}
          size="xs"
          loading={isExecuting}
          bg="accent.teal"
          color="white"
          _hover={{ opacity: 0.9 }}
          fontWeight="600"
          fontFamily="mono"
          px={3}
          flexShrink={0}
          disabled={issues.length > 0}
        >
          <LuPlay size={12} fill="currentColor" />
          Run
        </Button>
      )}
    </HStack>
  );

  // --- shelves: the current selection, always visible on top --------------------

  const shelfLabel = (label: string, empty: boolean) => (
    <Text
      fontSize="2xs" fontWeight="700" color="fg.subtle"
      textTransform="uppercase" letterSpacing="0.06em"
      opacity={empty ? 0.45 : 1}
      flexShrink={0}
    >
      {label}
    </Text>
  );

  const shelves = spec && (
    <Box aria-label="Semantic shelves" px={3} py={2} flexShrink={0} borderBottom="1px solid" borderColor="border.muted" bg="bg.surface">
      <HStack gap={4} rowGap={1.5} flexWrap="wrap" align="center">
        <HStack gap={1.5} align="center" flexWrap="wrap">
          {shelfLabel('Metrics', spec.metrics.length === 0)}
          {spec.metrics.map((name) => (
            <ShelfChip
              key={name}
              label={`Metrics chip: ${name}`}
              accent="accent.primary"
              onRemove={spec.metrics.length > 1 ? () => update({ metrics: spec.metrics.filter((m) => m !== name) }) : undefined}
            >
              <Text fontSize="xs" fontFamily="mono">{name}</Text>
            </ShelfChip>
          ))}
        </HStack>
        <HStack gap={1.5} align="center" flexWrap="wrap">
          {shelfLabel('Dimensions', spec.dimensions.length === 0)}
          {spec.dimensions.map((name) => (
            <ShelfChip
              key={name}
              label={`Dimensions chip: ${name}`}
              accent="accent.warning"
              onRemove={() => update({ dimensions: spec.dimensions.filter((d) => d !== name) })}
            >
              <Text fontSize="xs" fontFamily="mono">{name}</Text>
            </ShelfChip>
          ))}
        </HStack>
        {temporalDims.length > 0 && (
          <HStack gap={1.5} align="center" flexWrap="wrap">
            {shelfLabel('Time', !spec.timeGrain)}
            {spec.timeGrain && (
              <ShelfChip label={`Time chip: ${timeLabel}`} accent="accent.secondary" onRemove={() => update({ timeGrain: undefined })}>
                <Text fontSize="xs" fontFamily="mono">{timeLabel}</Text>
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
          </HStack>
        )}
        <HStack gap={1.5} align="center" flexWrap="wrap">
          {shelfLabel('Filters', (spec.filters ?? []).length === 0)}
          {(spec.filters ?? []).map((f, idx) => (
            <SemanticFilterPicker
              key={`${f.dimension}-${f.operator}-${filterValueString(f)}-${idx}`}
              dimensions={model ? model.dimensions.map((d) => d.name) : [f.dimension]}
              initial={f}
              onSubmit={(filter) => update({ filters: (spec.filters ?? []).map((prev, i) => (i === idx ? filter : prev)) })}
              trigger={(openEditor) => (
                // The Box is the popover anchor: Popover.Trigger asChild needs a
                // ref-forwarding element, which the plain ShelfChip fn is not —
                // without it the popover loses its anchor and renders top-left.
                <Box display="inline-flex">
                  <ShelfChip
                    label={`Filter chip: ${f.dimension}`}
                    accent="accent.cyan"
                    onClick={openEditor}
                    onRemove={() => update({ filters: (spec.filters ?? []).filter((_, i) => i !== idx) })}
                  >
                    <Text fontSize="xs" fontFamily="mono">
                      {f.operator === 'IS NULL' || f.operator === 'IS NOT NULL'
                        ? `${f.dimension} ${f.operator}`
                        : `${f.dimension} ${f.operator} ${Array.isArray(f.value) ? `(${f.value.join(', ')})` : String(f.value ?? '')}`}
                    </Text>
                  </ShelfChip>
                </Box>
              )}
            />
          ))}
          {model && (
            <SemanticFilterPicker
              dimensions={model.dimensions.map((d) => d.name)}
              onSubmit={(filter) => update({ filters: [...(spec.filters ?? []), filter] })}
              trigger={(openEditor) => (
                <Box aria-label="Add semantic filter">
                  <AddChipButton onClick={openEditor} variant="filter" />
                </Box>
              )}
            />
          )}
        </HStack>
        <HStack gap={1.5} align="center" ml="auto">
          {shelfLabel('Limit', !spec.limit)}
          <Input
            aria-label="Semantic row limit"
            size="2xs" width="64px" type="number" fontFamily="mono" fontSize="xs"
            value={spec.limit ?? ''}
            placeholder="1000"
            onChange={(e) => {
              const limit = parseInt(e.target.value, 10);
              update({ limit: isNaN(limit) || limit <= 0 ? undefined : limit });
            }}
          />
        </HStack>
      </HStack>
    </Box>
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
    <Box aria-label={ariaLabel} display="flex" flexDirection="column" minW={0}>
      <HStack
        gap={1.5} px={2.5} py={1.5} flexShrink={0}
        borderBottom="1px solid" borderColor="border.muted"
        {...(first ? {} : { borderTop: '1px solid', borderTopColor: 'border.muted' })}
        position="sticky" top={0} bg="bg.muted" zIndex={1}
      >
        {icon}
        <Text fontSize="2xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" color="fg.muted">{label}</Text>
        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" ml="auto">{count}</Text>
      </HStack>
      <VStack align="stretch" gap={1} px={1.5} py={1.5}>
        {count === 0
          ? <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" px={1} py={1}>{emptyText}</Text>
          : rows}
      </VStack>
    </Box>
  );

  // Two columns: Dimensions with Time beneath (neither list is usually long),
  // Measures on the right.
  const columns = model && spec && (
    <Grid templateColumns="minmax(0,1fr) minmax(0,1fr)" flex={1} minH={0}>
      <Box borderRight="1px solid" borderColor="border.muted" overflowY="auto" minH={0} minW={0}>
        {fieldSection(
          'Dimensions column', 'Dimensions',
          <LuTag size={11} color="var(--chakra-colors-accent-warning)" />,
          visibleDimensions.length,
          visibleDimensions.map((d) => fieldRow(
            d.name,
            spec.dimensions.includes(d.name),
            'accent.warning',
            <LuTag size={12} color="var(--chakra-colors-accent-warning)" />,
            () => toggleDimension(d.name),
            `Field dimension: ${d.name}`,
          )),
          query ? 'No matches' : 'No dimensions',
        )}
        {fieldSection(
          'Time column', 'Time',
          <LuCalendarDays size={11} color="var(--chakra-colors-accent-secondary)" />,
          visibleTemporal.length,
          <>
            {visibleTemporal.map((d) => fieldRow(
              d.name,
              (!!spec.timeGrain && effectiveTimeColumn === d.column) || spec.dimensions.includes(d.name),
              'accent.secondary',
              <LuCalendarDays size={12} color="var(--chakra-colors-accent-secondary)" />,
              () => (spec.dimensions.includes(d.name) ? toggleDimension(d.name) : toggleTime(d.column)),
              `Field time: ${d.name}`,
            ))}
          </>,
          query ? 'No matches' : 'No time fields',
          false,
        )}
      </Box>
      <Box overflowY="auto" minH={0} minW={0}>
        {fieldSection(
          'Metrics column', 'Metrics',
          <LuSigma size={11} color="var(--chakra-colors-accent-primary)" />,
          visibleMetrics.length,
          visibleMetrics.map((m) => {
            const MetricRowIcon = m.icon;
            return fieldRow(
              m.name,
              spec.metrics.includes(m.name),
              'accent.primary',
              <MetricRowIcon size={12} color="var(--chakra-colors-accent-primary)" />,
              () => toggleMetric(m.name),
              `Field metric: ${m.name}`,
              m.tag,
            );
          }),
          query ? 'No matches' : 'No metrics',
        )}
      </Box>
    </Grid>
  );

  // --- model picker (no model yet, or explicitly changing model) -----------------
  // §2.4: the browse surface lists MODELS — never raw tables. Each row is the
  // authored NAME (what the spec/compiler resolve against) subtitled with the
  // primary source it reads and its description.

  const visibleModels = models.filter((m) => matches(query, `${m.name} ${m.description ?? ''}`));

  const modelPicker = (
    <VStack aria-label="Semantic model picker" align="stretch" gap={1} px={3} py={2} overflowY="auto" flex={1} minH={0}>
      {spec && !model && (
        <Text aria-label="semantic-model-unavailable" fontSize="2xs" fontFamily="mono" color="orange.400" px={1} pb={1}>
          &quot;{spec.model}&quot; isn&apos;t available here — pick a model below
        </Text>
      )}
      <HStack gap={1.5} pb={1}>
        <Icon as={LuLayers} boxSize={3} color="accent.secondary" />
        <Text fontSize="2xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" color="fg.muted">Semantic models</Text>
        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" ml="auto">{visibleModels.length}</Text>
      </HStack>
      {visibleModels.length === 0 ? (
        <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" px={1} py={1}>No models match</Text>
      ) : visibleModels.map((m) => (
        <HStack
          key={m.name}
          aria-label={`Pick model: ${m.name}`}
          as="button"
          gap={2} px={2} py={1.5}
          borderRadius="md" border="1px solid" borderColor="transparent"
          cursor="pointer"
          _hover={{ bg: 'bg.muted' }}
          onClick={() => pickModel(m)}
          userSelect="none"
          width="100%"
          textAlign="left"
          flexShrink={0}
          transition="background 0.1s ease"
        >
          <Icon as={LuLayers} boxSize={3.5} color="accent.secondary" flexShrink={0} />
          <VStack align="stretch" gap={0} flex={1} minW={0}>
            <Text fontSize="xs" fontFamily="mono" fontWeight="600" truncate>{m.name}</Text>
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate>
              {primaryLabel(m)}{m.description ? ` · ${m.description}` : ''}
            </Text>
          </VStack>
        </HStack>
      ))}
    </VStack>
  );

  // --- cross-model search hits (pinned under the columns) -------------------------

  const otherTablesStrip = foreignHits.length > 0 && (
    <Box flexShrink={0} borderTop="1px solid" borderColor="border.muted" px={3} py={2} maxH="160px" overflowY="auto" bg="bg.surface">
      <HStack gap={1.5} pb={1.5}>
        <LuListFilter size={11} color="var(--chakra-colors-fg-subtle)" />
        <Text fontSize="2xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" color="fg.muted">Other models</Text>
      </HStack>
      <VStack align="stretch" gap={1}>
        {foreignHits.map((h) => (
          <HStack
            key={`${h.kind}:${h.model}:${h.name}`}
            aria-label={`Other model field ${h.kind}: ${h.name} (${h.model})`}
            as="button"
            gap={1.5} px={2} py={1}
            borderRadius="md" border="1px dashed" borderColor="border.muted"
            _hover={{ bg: 'bg.muted' }}
            onClick={() => pickOtherHit(h)}
            width="100%"
            textAlign="left"
            flexShrink={0}
          >
            {h.kind === 'dimension'
              ? <LuTag size={12} color="var(--chakra-colors-accent-warning)" />
              : <LuSigma size={12} color="var(--chakra-colors-accent-primary)" />}
            <Text fontSize="xs" fontFamily="mono" flex={1} truncate>{h.name}</Text>
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate maxW="90px">{h.model}</Text>
          </HStack>
        ))}
      </VStack>
    </Box>
  );

  // M5 (Semantic_Model_v2.md §2.7): models are AUTHORED, not derived. `models`
  // is the FULL authored set for this connection (fetched unscoped), so an
  // empty one genuinely means "none authored" — point at where they're made.
  // Anything else lands on the picker below, never on this state.
  if (models.length === 0) {
    return (
      <VStack align="center" justify="center" h="100%" minH={0} px={6} py={8} gap={2}>
        <Icon as={LuLayers} boxSize={5} color="fg.subtle" />
        <Text
          aria-label="semantic-models-empty-state"
          fontSize="xs"
          fontFamily="mono"
          color="fg.muted"
          textAlign="center"
          maxW="360px"
        >
          No semantic models yet — create one in the knowledge base (context) editor
        </Text>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={0} h="100%" minH={0}>
      {!browsingModels && shelves}
      {topStrip}
      {/* No spec, explicitly changing model, or a spec naming a model that no
          longer exists → the picker. Never a dead "Loading …" screen. */}
      {!spec || browsingModels || !model ? modelPicker : columns}
      {otherTablesStrip}
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function ShelfChip({ label, accent = 'border.muted', onRemove, onClick, children }: {
  label: string; accent?: string; onRemove?: () => void; onClick?: () => void; children: React.ReactNode;
}) {
  return (
    <HStack
      aria-label={label}
      gap={1.5} px={2} py={0.5}
      bg={`${accent}/8`} borderRadius="md" border="1px solid" borderColor={`${accent}/25`}
      userSelect="none"
      {...(onClick ? { onClick, cursor: 'pointer', _hover: { bg: `${accent}/15` } } : {})}
    >
      {children}
      {onRemove && (
        <Box
          as="button"
          aria-label={`Remove ${label.split(': ')[1]} from ${label.split(' chip')[0]}`}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove(); }}
          color="fg.subtle"
          _hover={{ color: 'accent.danger' }}
          flexShrink={0}
        >
          <LuX size={12} />
        </Box>
      )}
    </HStack>
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
      <VStack gap={2} align="stretch">
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
            <Text fontSize="xs" fontFamily="mono" fontWeight="600">{dimension}</Text>
            <HStack gap={1} flexWrap="wrap">
              {OPERATORS.map((op) => (
                <Button
                  key={op}
                  aria-label={`Semantic operator ${op}`}
                  size="2xs"
                  variant={operator === op ? 'solid' : 'outline'}
                  fontFamily="mono"
                  onClick={() => setOperator(op)}
                >
                  {op}
                </Button>
              ))}
            </HStack>
            {needsValue && (
              <Input
                aria-label="Semantic filter value"
                size="sm"
                fontFamily="mono"
                fontSize="xs"
                placeholder={operator === 'IN' ? 'a, b, c' : 'value'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                autoFocus
              />
            )}
            <HStack justify="flex-end" gap={2}>
              <Button size="2xs" variant="outline" onClick={close}>Cancel</Button>
              <Button aria-label="Apply semantic filter" size="2xs" bg="accent.teal" color="white" onClick={submit}
                disabled={!dimension || (needsValue && !value.trim())}>
                Apply
              </Button>
            </HStack>
          </>
        )}
      </VStack>
    </PickerPopover>
  );
}
