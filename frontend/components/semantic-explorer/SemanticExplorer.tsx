'use client';

/**
 * SemanticExplorer — the single-surface semantic exploration canvas
 * (PyGWalker/ThoughtSpot style). LEFT: the fields rail (measures /
 * dimensions / time — click to add, or drag). RIGHT: the semantic shelves
 * (Metrics / Dimensions / Time / Filters) as drop zones with removable
 * chips, a collapsible Chart section (the parent supplies the full viz
 * panel), limit, and execute.
 *
 * Every edit compiles the spec to dialect SQL client-side
 * (compileSemanticQuery → irToSqlLocal) and emits `(spec, sql, viz)` where
 * viz is the auto-inferred VizMatch — the parent decides whether to apply
 * viz.type (it must not while the user has locked a manual chart type).
 *
 * Replaces SemanticCanvas: same spec semantics and field vocabulary, but the
 * selection summary became true shelves and the viz choice moved in here.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, VStack, HStack, Text, Button, Input } from '@chakra-ui/react';
import { LuPlay, LuPause, LuTriangleAlert, LuChevronDown, LuChevronRight, LuChartColumn } from 'react-icons/lu';
import { compileSemanticQuery, validateSemanticQuery } from '@/lib/semantic/compile';
import { autoVizForSpec, type VizMatch } from '@/lib/semantic/infer-viz';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { searchFields, type SemanticFieldHit } from '@/lib/semantic/models-client';
import type { ModelStub } from '@/lib/semantic/derive';
import type { SemanticModel, SemanticTimeGrain } from '@/lib/types';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';
import { DropZone, useIsTouchDevice } from '../plotx/AxisComponents';
import { AddChipButton } from '../query-builder/QueryChip';
import { FieldsRail, type DraggingField } from './FieldsRail';
import { FilterEditor, ShelfChip, filterChipText } from './FilterEditor';
import { SqlPeekDrawer } from './SqlPeekDrawer';

const TIME_GRAINS: SemanticTimeGrain[] = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];

type ShelfKind = 'metrics' | 'dimensions' | 'time' | 'filters';

interface SemanticExplorerProps {
  /** Full models loaded for the tables in play (fetched on demand). */
  models: SemanticModel[];
  /** One cheap stub per whitelisted table — the empty-state table list. */
  stubs: ModelStub[];
  /** Ask the parent to load the full model for a picked stub / search hit. */
  onSelectModel: (stub: ModelStub) => void;
  dialect: string;
  /** Context anchor + connection for the cross-table field search. */
  path: string;
  connectionName: string;
  /** Persisted spec from content.semanticQuery, if any. Read once per mount. */
  value: SemanticQuerySpec | null | undefined;
  /** Emits the edited spec, the SQL compiled from it, and the inferred viz. */
  onChange: (spec: SemanticQuerySpec, sql: string, viz: VizMatch) => void;
  /** The FULL chart panel (type selector + config), supplied by the parent —
   *  rendered in a collapsible Chart section below the shelves. The parent
   *  owns it because it needs the query result columns and the whole
   *  vizSettings handler set; the explorer stays purely semantic. */
  chartPanel?: React.ReactNode;
  onExecute?: () => void;
  isExecuting?: boolean;
  /** Auto-run state: undefined = no auto-run capability (legacy manual mode,
   *  Execute button always shown); true = running on every edit (pause
   *  offered); false = paused (resume + Execute offered). */
  autoRun?: boolean;
  onToggleAutoRun?: () => void;
  /** The compiled SQL for the peek drawer (content.query, always in sync). */
  compiledSql?: string;
  /** Jump to the full SQL editor tab. */
  onEditSql?: () => void;
}

const specForStub = (stub: ModelStub): SemanticQuerySpec => ({
  model: stub.name,
  table: stub.table,
  ...(stub.schema ? { schema: stub.schema } : {}),
  measures: [],
  dimensions: [],
});

export function SemanticExplorer({
  models,
  stubs,
  onSelectModel,
  dialect,
  path,
  connectionName,
  value,
  onChange,
  chartPanel,
  onExecute,
  isExecuting = false,
  autoRun,
  onToggleAutoRun,
  compiledSql,
  onEditSql,
}: SemanticExplorerProps) {
  const [spec, setSpec] = useState<SemanticQuerySpec | null>(() => value ?? null);
  const [browsingTables, setBrowsingTables] = useState(false);
  const [query, setQuery] = useState('');
  const [otherHits, setOtherHits] = useState<SemanticFieldHit[]>([]);
  const searchSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isTouchDevice = useIsTouchDevice();

  // Drag state: the rail row being dragged; shelves consume it on drop.
  const [draggingField, setDraggingField] = useState<DraggingField | null>(null);
  // Filter editor state: the add/drop editor (with optional preset dimension)
  // and the edit-in-place editor (index of the chip being edited).
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const [presetFilterDim, setPresetFilterDim] = useState<string | undefined>(undefined);
  const [editingFilterIdx, setEditingFilterIdx] = useState<number | null>(null);
  const [chartOpen, setChartOpen] = useState(true);

  const model = spec ? models.find((m) => m.name === spec.model) : undefined;
  const issues = spec && model ? validateSemanticQuery(spec, model) : [];

  const apply = useCallback((next: SemanticQuerySpec, nextModel: SemanticModel) => {
    setSpec(next);
    if (validateSemanticQuery(next, nextModel).length > 0) return;
    try {
      const sql = irToSqlLocal(compileSemanticQuery(next, nextModel), dialect);
      onChange(next, sql, autoVizForSpec(next, nextModel));
    } catch (err) {
      console.error('[SemanticExplorer] compile failed:', err);
    }
  }, [dialect, onChange]);

  const update = useCallback((updates: Partial<SemanticQuerySpec>) => {
    if (spec && model) apply({ ...spec, ...updates }, model);
  }, [apply, spec, model]);

  // --- toggles (click-to-add from the rail) -----------------------------------

  const toggleMeasure = useCallback((name: string) => {
    if (!spec || !model) return;
    update({
      measures: spec.measures.includes(name)
        ? spec.measures.filter((m) => m !== name)
        : [...spec.measures, name],
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

  // Any BASE temporal column can be the time axis. Clicking the active one
  // clears it; clicking another temporal column moves the axis there.
  const toggleTime = useCallback((column?: string) => {
    if (!spec || !model) return;
    const target = column ?? model.timeDimension?.column;
    if (!target) return;
    const effective = spec.timeColumn ?? model.timeDimension?.column;
    if (spec.timeGrain && effective === target) {
      update({ timeGrain: undefined, timeColumn: undefined });
    } else {
      update({
        timeGrain: spec.timeGrain ?? 'MONTH',
        timeColumn: target === model.timeDimension?.column ? undefined : target,
      });
    }
  }, [spec, model, update]);

  // A freshly picked (or detected/persisted) model finishing its fetch: give
  // the spec its default measure so the query is immediately runnable.
  useEffect(() => {
    if (!spec || spec.measures.length > 0) return;
    const loaded = models.find((m) => m.name === spec.model);
    if (loaded && loaded.measures.length > 0) {
      Promise.resolve().then(() => apply({ ...spec, measures: [loaded.measures[0].name] }, loaded));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, spec?.model, spec?.measures.length]);

  // --- cross-table search (feeds the "Other tables" section of the rail) ------

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

  const pickStub = useCallback((stub: ModelStub) => {
    onSelectModel(stub);
    setSpec(specForStub(stub));
    setBrowsingTables(false);
    setQuery('');
    setOtherHits([]);
  }, [onSelectModel]);

  const pickOtherHit = useCallback((hit: SemanticFieldHit) => {
    onSelectModel({ name: hit.model, connection: hit.connection, schema: hit.schema, table: hit.table });
    setSpec({
      model: hit.model,
      table: hit.table,
      ...(hit.schema ? { schema: hit.schema } : {}),
      measures: hit.kind === 'measure' ? [hit.name] : [],
      dimensions: hit.kind === 'dimension' ? [hit.name] : [],
    });
    setQuery('');
    setOtherHits([]);
  }, [onSelectModel]);

  // --- shelf drops -------------------------------------------------------------

  const handleShelfDrop = useCallback((shelf: ShelfKind) => {
    const field = draggingField;
    setDraggingField(null);
    if (!field || !spec || !model) return;
    switch (shelf) {
      case 'metrics':
        if (field.kind === 'measure' && !spec.measures.includes(field.name)) {
          update({ measures: [...spec.measures, field.name] });
        }
        break;
      case 'dimensions':
        if (
          (field.kind === 'dimension' || (field.kind === 'time' && model.dimensions.some((d) => d.name === field.name)))
          && !spec.dimensions.includes(field.name)
        ) {
          update({ dimensions: [...spec.dimensions, field.name] });
        }
        break;
      case 'time':
        if (field.kind === 'time' && field.column) {
          update({
            timeGrain: spec.timeGrain ?? 'MONTH',
            timeColumn: field.column === model.timeDimension?.column ? undefined : field.column,
          });
        }
        break;
      case 'filters':
        if (field.kind === 'dimension' || field.kind === 'time') {
          setPresetFilterDim(field.name);
          setAddFilterOpen(true);
        }
        break;
    }
  }, [draggingField, spec, model, update]);

  // --- shelves -------------------------------------------------------------------

  const effectiveTimeColumn = spec?.timeColumn ?? model?.timeDimension?.column;
  const timeLabel = model
    ? (model.dimensions.find((d) => d.column === effectiveTimeColumn && !d.join)?.name
        ?? model.timeDimension?.label ?? model.timeDimension?.column ?? 'Time')
    : 'Time';

  const filters = spec?.filters ?? [];

  const shelves = spec && (
    <VStack align="stretch" gap={3} flex={1} minW={0} overflowY="auto">
      <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">
        {spec.model}
      </Text>

      <DropZone label="Metrics" ariaLabel="Metrics shelf" onDrop={() => handleShelfDrop('metrics')} isTouchDevice={false}>
        <HStack gap={1.5} flexWrap="wrap" minH="26px">
          {spec.measures.map((name) => (
            <ShelfChip
              key={name}
              label={`Metrics chip: ${name}`}
              onRemove={spec.measures.length > 1 ? () => update({ measures: spec.measures.filter((m) => m !== name) }) : undefined}
            >
              <Text fontSize="xs" fontFamily="mono">{name}</Text>
            </ShelfChip>
          ))}
        </HStack>
      </DropZone>

      <DropZone label="Dimensions" ariaLabel="Dimensions shelf" onDrop={() => handleShelfDrop('dimensions')} isTouchDevice={false}>
        <HStack gap={1.5} flexWrap="wrap" minH="26px">
          {spec.dimensions.map((name) => (
            <ShelfChip
              key={name}
              label={`Dimensions chip: ${name}`}
              onRemove={() => update({ dimensions: spec.dimensions.filter((d) => d !== name) })}
            >
              <Text fontSize="xs" fontFamily="mono">{name}</Text>
            </ShelfChip>
          ))}
        </HStack>
      </DropZone>

      <DropZone label="Time" ariaLabel="Time shelf" onDrop={() => handleShelfDrop('time')} isTouchDevice={false}>
        <HStack gap={1.5} flexWrap="wrap" minH="26px">
          {spec.timeGrain && (
            <ShelfChip label={`Time chip: ${timeLabel}`} onRemove={() => update({ timeGrain: undefined, timeColumn: undefined })}>
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
      </DropZone>

      <DropZone label="Filters" ariaLabel="Filters shelf" onDrop={() => handleShelfDrop('filters')} isTouchDevice={false}>
        <HStack gap={1.5} flexWrap="wrap" minH="26px">
          {filters.map((f, idx) => (
            <FilterEditor
              key={`${f.dimension}-${idx}`}
              dimensions={model?.dimensions.map((d) => d.name) ?? []}
              initial={f}
              open={editingFilterIdx === idx}
              onOpenChange={(open) => setEditingFilterIdx(open ? idx : null)}
              onSubmit={(filter) => update({ filters: filters.map((prev, i) => (i === idx ? filter : prev)) })}
              trigger={
                <ShelfChip
                  label={`Filter chip: ${f.dimension}`}
                  onClick={() => setEditingFilterIdx(idx)}
                  onRemove={() => update({ filters: filters.filter((_, i) => i !== idx) })}
                >
                  <Text fontSize="xs" fontFamily="mono">{filterChipText(f)}</Text>
                </ShelfChip>
              }
            />
          ))}
          {model && (
            <FilterEditor
              dimensions={model.dimensions.map((d) => d.name)}
              presetDimension={presetFilterDim}
              open={addFilterOpen}
              onOpenChange={(open) => {
                setAddFilterOpen(open);
                if (!open) setPresetFilterDim(undefined);
              }}
              onSubmit={(filter) => update({ filters: [...filters, filter] })}
              trigger={
                <Box aria-label="Add semantic filter">
                  <AddChipButton onClick={() => setAddFilterOpen(true)} variant="filter" />
                </Box>
              }
            />
          )}
        </HStack>
      </DropZone>

      {chartPanel && (
        <Box borderTop="1px solid" borderColor="border.muted" pt={2}>
          <HStack
            as="button"
            aria-label="Toggle chart section"
            gap={1.5}
            color="fg.muted"
            _hover={{ color: 'fg.default' }}
            onClick={() => setChartOpen((o) => !o)}
            width="100%"
          >
            {chartOpen ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
            <LuChartColumn size={12} />
            <Text fontSize="2xs" fontFamily="mono" fontWeight="600" textTransform="uppercase" letterSpacing="0.05em">
              Chart
            </Text>
          </HStack>
          {chartOpen && <Box mt={2}>{chartPanel}</Box>}
        </Box>
      )}

      <HStack justify="space-between" align="center">
        <HStack gap={2}>
          {autoRun !== undefined && onToggleAutoRun && (
            <HStack
              as="button"
              aria-label={autoRun ? 'Pause auto-run' : 'Resume auto-run'}
              gap={1}
              px={1.5} py={0.5}
              borderRadius="sm"
              border="1px solid"
              borderColor={autoRun ? 'accent.teal' : 'border.muted'}
              color={autoRun ? 'accent.teal' : 'fg.muted'}
              _hover={{ bg: 'bg.muted' }}
              onClick={onToggleAutoRun}
              title={autoRun ? 'Auto-run is on: every change runs the query' : 'Auto-run paused: changes wait for Execute'}
            >
              {autoRun ? <LuPause size={11} /> : <LuPlay size={11} />}
              <Text fontSize="2xs" fontFamily="mono" fontWeight="600">auto</Text>
            </HStack>
          )}
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">Limit</Text>
          <Input
            aria-label="Semantic row limit"
            size="xs" width="90px" type="number" fontFamily="mono"
            value={spec.limit ?? ''}
            placeholder="1000"
            onChange={(e) => {
              const limit = parseInt(e.target.value, 10);
              update({ limit: isNaN(limit) || limit <= 0 ? undefined : limit });
            }}
          />
        </HStack>
        {issues.length > 0 && (
          <HStack gap={1.5} color="orange.400">
            <LuTriangleAlert size={12} />
            <Text fontSize="xs" fontFamily="mono">{issues[0]}</Text>
          </HStack>
        )}
      </HStack>

      {onExecute && autoRun !== true && (
        <Button
          aria-label="Execute semantic query"
          onClick={onExecute}
          size="lg"
          loading={isExecuting}
          loadingText="Running..."
          width="full"
          bg="accent.teal"
          color="white"
          _hover={{ opacity: 0.9, transform: 'translateY(-1px)' }}
          transition="all 0.2s ease"
          fontWeight="600"
          letterSpacing="0.02em"
          disabled={issues.length > 0}
        >
          <LuPlay size={18} fill="white" />
          <Text ml={2} fontFamily="mono">Execute</Text>
        </Button>
      )}

      {compiledSql && <SqlPeekDrawer sql={compiledSql} onEditSql={onEditSql} />}
    </VStack>
  );

  const emptyState = !spec && (
    <VStack align="stretch" gap={2} flex={1} minW={0} pt={8}>
      <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textAlign="center">
        Pick a table on the left, or search for a measure or dimension.
      </Text>
    </VStack>
  );

  return (
    <HStack align="stretch" gap={3} p={4} h="100%" minH={0}>
      <FieldsRail
        spec={spec}
        model={model}
        stubs={stubs}
        browsingTables={browsingTables}
        onToggleBrowse={() => setBrowsingTables((b) => !b)}
        query={query}
        onQueryChange={runSearch}
        otherHits={otherHits}
        onPickStub={pickStub}
        onPickOtherHit={pickOtherHit}
        onToggleMeasure={toggleMeasure}
        onToggleDimension={toggleDimension}
        onToggleTime={toggleTime}
        isTouchDevice={isTouchDevice}
        onFieldDragStart={setDraggingField}
        onFieldDragEnd={() => setDraggingField(null)}
      />
      {shelves}
      {emptyState}
    </HStack>
  );
}
