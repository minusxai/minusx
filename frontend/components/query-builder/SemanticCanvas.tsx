'use client';

/**
 * SemanticCanvas — the PygWalker-style semantic query editor (the Semantic tab).
 *
 * Field list on the left (measures / dimensions / time, from the derived
 * SemanticModel), shelves on the right: X-Axis (one dimension OR the time
 * grain), Y-Axis (measures), Color (a second dimension), Filter, Limit.
 * Fields can be clicked (they land on their natural shelf) or dragged onto a
 * specific shelf. Every edit compiles the spec to dialect SQL client-side
 * (compileSemanticQuery → irToSqlLocal) and emits `(spec, sql, viz)` — the viz
 * assignment (chart type + axis columns) is implied by the shelves, so
 * building the query IS building the chart.
 *
 * Shelf ⟷ spec mapping (canonical both ways):
 *   X-Axis  = spec.timeGrain (wins) else spec.dimensions[0]
 *   Color   = the remaining dimension (dimensions[1], or [0] when time is on X)
 *   Y-Axis  = spec.measures
 *
 * Models load on demand: the model picker lists cheap `stubs`, and the
 * metrics-first search box finds measures/dimensions across EVERY whitelisted
 * table (POST /api/semantic-models {q}) — picking a hit infers the model.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, VStack, HStack, Text, Button, Input } from '@chakra-ui/react';
import { LuPlay, LuSigma, LuGroup, LuClock, LuSearch, LuTriangleAlert, LuX } from 'react-icons/lu';
import { compileSemanticQuery, validateSemanticQuery, semanticAlias } from '@/lib/semantic/compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { searchFields, type SemanticFieldHit } from '@/lib/semantic/models-client';
import { DropZone } from '@/components/plotx/AxisComponents';
import type { ModelStub } from '@/lib/semantic/derive';
import type { SemanticModel, SemanticTimeGrain, VizSettings } from '@/lib/types';
import type { SemanticQuerySpec, SemanticQueryFilter } from '@/lib/validation/atlas-schemas';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
import { AddChipButton } from './QueryChip';

const TIME_GRAINS: SemanticTimeGrain[] = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];
const OPERATORS: SemanticQueryFilter['operator'][] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL'];

/** The viz assignment implied by the shelves. */
export interface SemanticVizAssignment {
  type: VizSettings['type'];
  xCols: string[];
  yCols: string[];
}

interface SemanticCanvasProps {
  /** Full models loaded for the tables in play (fetched on demand). */
  models: SemanticModel[];
  /** One cheap stub per whitelisted table — the model picker's item list. */
  stubs: ModelStub[];
  /** Ask the parent to load the full model for a picked stub / search hit. */
  onSelectModel: (stub: ModelStub) => void;
  dialect: string;
  /** Context anchor + connection for the metrics-first field search. */
  path: string;
  connectionName: string;
  /** Persisted spec from content.semanticQuery, if any. */
  value: SemanticQuerySpec | null | undefined;
  /** Emits the edited spec, the SQL compiled from it, and the shelf-implied viz. */
  onChange: (spec: SemanticQuerySpec, sql: string, viz: SemanticVizAssignment) => void;
  onExecute?: () => void;
  isExecuting?: boolean;
}

type DragItem = { kind: 'measure' | 'dimension' | 'time'; name: string };

const specForStub = (stub: ModelStub): SemanticQuerySpec => ({
  model: stub.name,
  table: stub.table,
  ...(stub.schema ? { schema: stub.schema } : {}),
  measures: [],
  dimensions: [],
});

/** Shelf decomposition of a spec (see file comment). */
const shelvesOf = (spec: SemanticQuerySpec) => ({
  x: spec.timeGrain ? null : spec.dimensions[0] ?? null,
  time: spec.timeGrain ?? null,
  color: spec.timeGrain ? spec.dimensions[0] ?? null : spec.dimensions[1] ?? null,
});

const vizOf = (spec: SemanticQuerySpec): SemanticVizAssignment => {
  const { x, time, color } = shelvesOf(spec);
  const xCols = [
    ...(time ? [time.toLowerCase()] : x ? [semanticAlias(x)] : []),
    ...(color ? [semanticAlias(color)] : []),
  ];
  return {
    type: time ? 'line' : xCols.length > 0 ? 'bar' : 'table',
    xCols,
    yCols: spec.measures.map(semanticAlias),
  };
};

export function SemanticCanvas({
  models,
  stubs,
  onSelectModel,
  dialect,
  path,
  connectionName,
  value,
  onChange,
  onExecute,
  isExecuting = false,
}: SemanticCanvasProps) {
  const [spec, setSpec] = useState<SemanticQuerySpec | null>(() => value ?? null);
  const [dragging, setDragging] = useState<DragItem | null>(null);

  const model = spec ? models.find((m) => m.name === spec.model) : undefined;
  const issues = spec && model ? validateSemanticQuery(spec, model) : [];
  const shelves = spec ? shelvesOf(spec) : { x: null, time: null, color: null };

  const apply = useCallback((next: SemanticQuerySpec, nextModel: SemanticModel) => {
    setSpec(next);
    if (validateSemanticQuery(next, nextModel).length > 0) return;
    try {
      const sql = irToSqlLocal(compileSemanticQuery(next, nextModel), dialect);
      onChange(next, sql, vizOf(next));
    } catch (err) {
      console.error('[SemanticCanvas] compile failed:', err);
    }
  }, [dialect, onChange]);

  const update = useCallback((updates: Partial<SemanticQuerySpec>) => {
    if (spec && model) apply({ ...spec, ...updates }, model);
  }, [apply, spec, model]);

  // --- shelf operations ------------------------------------------------------

  const addMeasure = useCallback((name: string) => {
    if (!spec || !model || spec.measures.includes(name)) return;
    update({ measures: [...spec.measures, name] });
  }, [spec, model, update]);

  const addDimension = useCallback((name: string, shelf: 'x' | 'color' | 'auto') => {
    if (!spec || !model) return;
    const { x, time, color } = shelvesOf(spec);
    if (spec.dimensions.includes(name)) return;
    const target = shelf === 'auto' ? ((x || time) ? 'color' : 'x') : shelf;
    let dimensions: string[];
    if (spec.timeGrain) {
      // time owns X: the single dimension slot is Color
      dimensions = [name];
    } else if (target === 'x') {
      dimensions = [name, ...(color ? [color] : [])];
    } else {
      dimensions = [...(x ? [x] : []), name];
    }
    update({ dimensions });
  }, [spec, model, update]);

  const addTime = useCallback((grain: SemanticTimeGrain = 'MONTH') => {
    if (!spec || !model?.timeDimension) return;
    // time takes X; keep at most one dimension (it becomes Color)
    update({ timeGrain: grain, dimensions: spec.dimensions.slice(0, 1) });
  }, [spec, model, update]);

  const removeFromShelf = useCallback((slot: 'x' | 'time' | 'color', name?: string) => {
    if (!spec) return;
    if (slot === 'time') { update({ timeGrain: undefined }); return; }
    update({ dimensions: spec.dimensions.filter((d) => d !== name) });
  }, [spec, update]);

  const handleDrop = useCallback((shelf: 'x' | 'y' | 'color') => {
    if (!dragging) return;
    if (shelf === 'y' && dragging.kind === 'measure') addMeasure(dragging.name);
    if (shelf === 'x' && dragging.kind === 'dimension') addDimension(dragging.name, 'x');
    if (shelf === 'x' && dragging.kind === 'time') addTime();
    if (shelf === 'color' && dragging.kind === 'dimension') addDimension(dragging.name, 'color');
    setDragging(null);
  }, [dragging, addMeasure, addDimension, addTime]);

  const clickField = useCallback((item: DragItem) => {
    if (item.kind === 'measure') addMeasure(item.name);
    else if (item.kind === 'time') addTime();
    else addDimension(item.name, 'auto');
  }, [addMeasure, addDimension, addTime]);

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

  // --- model + search entry points -------------------------------------------

  const pickStub = useCallback((stub: ModelStub) => {
    onSelectModel(stub);
    const loaded = models.find((m) => m.name === stub.name);
    setSpec(specForStub(stub));
    if (loaded && loaded.measures.length > 0) {
      apply({ ...specForStub(stub), measures: [loaded.measures[0].name] }, loaded);
    }
  }, [models, onSelectModel, apply]);

  const pickSearchHit = useCallback((hit: SemanticFieldHit) => {
    const seed: SemanticQuerySpec = {
      model: hit.model,
      table: hit.table,
      ...(hit.schema ? { schema: hit.schema } : {}),
      measures: hit.kind === 'measure' ? [hit.name] : [],
      dimensions: hit.kind === 'dimension' ? [hit.name] : [],
    };
    if (spec && model && hit.model === spec.model) {
      if (hit.kind === 'measure') addMeasure(hit.name);
      else addDimension(hit.name, 'auto');
      return;
    }
    onSelectModel({ name: hit.model, connection: hit.connection, schema: hit.schema, table: hit.table });
    setSpec(seed);
  }, [spec, model, onSelectModel, addMeasure, addDimension]);

  const modelPicker = (
    <PickerPopoverModel stubs={stubs} current={spec?.model} onPick={pickStub} />
  );

  const search = (
    <FieldSearch path={path} connection={connectionName} onPick={pickSearchHit} />
  );

  if (!spec) {
    return (
      <VStack align="stretch" gap={3} p={4}>
        {search}
        <HStack gap={2}>
          {modelPicker}
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">…or pick a table to start.</Text>
        </HStack>
      </VStack>
    );
  }

  if (!model) {
    return (
      <VStack align="stretch" gap={3} p={4}>
        {search}
        <HStack gap={2}>
          {modelPicker}
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">Loading {spec.model}…</Text>
        </HStack>
      </VStack>
    );
  }

  const fieldChip = (item: DragItem, assigned: boolean, icon: React.ReactNode) => (
    <HStack
      key={`${item.kind}:${item.name}`}
      aria-label={`Field ${item.kind}: ${item.name}`}
      gap={1.5} px={2} py={1}
      bg={assigned ? 'bg.muted' : 'transparent'}
      borderRadius="md" border="1px solid"
      borderColor={assigned ? 'accent.teal' : 'border.default'}
      cursor="grab"
      _hover={{ bg: 'bg.muted' }}
      draggable
      onDragStart={() => setDragging(item)}
      onDragEnd={() => setDragging(null)}
      onClick={() => clickField(item)}
      userSelect="none"
    >
      {icon}
      <Text fontSize="xs" fontFamily="mono" truncate>{item.name}</Text>
    </HStack>
  );

  const timeLabel = model.timeDimension?.label ?? model.timeDimension?.column ?? 'Time';

  return (
    <VStack align="stretch" gap={3} p={4}>
      {search}
      <HStack align="start" gap={3}>
        {/* Field list */}
        <VStack align="stretch" gap={2} w="220px" flexShrink={0}>
          {modelPicker}
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">Measures</Text>
          <VStack align="stretch" gap={1}>
            {model.measures.map((m) => fieldChip(
              { kind: 'measure', name: m.name },
              spec.measures.includes(m.name),
              <LuSigma size={12} color="var(--chakra-colors-accent-primary)" />,
            ))}
          </VStack>
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">Dimensions</Text>
          <VStack align="stretch" gap={1}>
            {model.timeDimension && fieldChip(
              { kind: 'time', name: timeLabel },
              !!spec.timeGrain,
              <LuClock size={12} color="var(--chakra-colors-accent-secondary)" />,
            )}
            {model.dimensions
              .filter((d) => d.column !== model.timeDimension?.column || d.join)
              .map((d) => fieldChip(
                { kind: 'dimension', name: d.name },
                spec.dimensions.includes(d.name),
                <LuGroup size={12} color="var(--chakra-colors-accent-warning)" />,
              ))}
          </VStack>
        </VStack>

        {/* Shelves */}
        <VStack align="stretch" gap={3} flex={1} minW={0}>
          <DropZone label="X-Axis" onDrop={() => handleDrop('x')}>
            <HStack gap={1.5} flexWrap="wrap">
              {shelves.time && (
                <ShelfChip label={`X-Axis chip: ${timeLabel}`} onRemove={() => removeFromShelf('time')}>
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
              {shelves.x && (
                <ShelfChip label={`X-Axis chip: ${shelves.x}`} onRemove={() => removeFromShelf('x', shelves.x!)}>
                  <Text fontSize="xs" fontFamily="mono">{shelves.x}</Text>
                </ShelfChip>
              )}
            </HStack>
          </DropZone>

          <DropZone label="Y-Axis" onDrop={() => handleDrop('y')}>
            <HStack gap={1.5} flexWrap="wrap">
              {spec.measures.map((name) => (
                <ShelfChip
                  key={name}
                  label={`Y-Axis chip: ${name}`}
                  onRemove={spec.measures.length > 1 ? () => update({ measures: spec.measures.filter((m) => m !== name) }) : undefined}
                >
                  <Text fontSize="xs" fontFamily="mono">{name}</Text>
                </ShelfChip>
              ))}
            </HStack>
          </DropZone>

          <DropZone label="Color" onDrop={() => handleDrop('color')}>
            <HStack gap={1.5} flexWrap="wrap">
              {shelves.color && (
                <ShelfChip label={`Color chip: ${shelves.color}`} onRemove={() => removeFromShelf('color', shelves.color!)}>
                  <Text fontSize="xs" fontFamily="mono">{shelves.color}</Text>
                </ShelfChip>
              )}
            </HStack>
          </DropZone>

          {/* Filters */}
          <Box>
            <HStack gap={1.5} flexWrap="wrap">
              {(spec.filters ?? []).map((f, idx) => (
                <ShelfChip
                  key={`${f.dimension}-${idx}`}
                  label={`Filter chip: ${f.dimension}`}
                  onRemove={() => update({ filters: (spec.filters ?? []).filter((_, i) => i !== idx) })}
                >
                  <Text fontSize="xs" fontFamily="mono">
                    {f.operator === 'IS NULL' || f.operator === 'IS NOT NULL'
                      ? `${f.dimension} ${f.operator}`
                      : `${f.dimension} ${f.operator} ${Array.isArray(f.value) ? `(${f.value.join(', ')})` : String(f.value ?? '')}`}
                  </Text>
                </ShelfChip>
              ))}
              <SemanticFilterPicker
                dimensions={model.dimensions.map((d) => d.name)}
                onAdd={(filter) => update({ filters: [...(spec.filters ?? []), filter] })}
              />
            </HStack>
          </Box>

          {/* Limit + issues + execute */}
          <HStack justify="space-between" align="center">
            <HStack gap={2}>
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

          {onExecute && (
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
        </VStack>
      </HStack>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function ShelfChip({ label, onRemove, children }: {
  label: string; onRemove?: () => void; children: React.ReactNode;
}) {
  return (
    <HStack
      aria-label={label}
      gap={1.5} px={2} py={1}
      bg="bg.muted" borderRadius="md" border="1px solid" borderColor="border.muted"
      userSelect="none"
    >
      {children}
      {onRemove && (
        <Box
          as="button"
          aria-label={`Remove ${label.split(': ')[1]} from ${label.split(' chip')[0]}`}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove(); }}
          _hover={{ color: 'accent.danger' }}
          flexShrink={0}
        >
          <LuX size={12} />
        </Box>
      )}
    </HStack>
  );
}

function PickerPopoverModel({ stubs, current, onPick }: {
  stubs: ModelStub[]; current: string | undefined; onPick: (stub: ModelStub) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PickerPopover
      open={open}
      onOpenChange={(d) => setOpen(d.open)}
      trigger={
        <Button aria-label="Semantic model" size="xs" variant="outline" fontFamily="mono" onClick={() => setOpen(true)}>
          {current ?? 'Pick a table…'}
        </Button>
      }
      width="300px"
      padding={3}
    >
      <VStack gap={2} align="stretch">
        <PickerHeader>Semantic models</PickerHeader>
        <PickerList maxH="260px" searchable searchPlaceholder="Search tables...">
          {(query) => stubs
            .filter((st) => !query || st.name.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 100)
            .map((st) => (
              <PickerItem
                key={`${st.schema ?? ''}.${st.table}`}
                aria-label={`Semantic models: ${st.name}`}
                selected={st.name === current}
                onClick={() => { onPick(st); setOpen(false); }}
              >
                {st.name}
              </PickerItem>
            ))}
        </PickerList>
      </VStack>
    </PickerPopover>
  );
}

/** Metrics-first entry point: search fields across every whitelisted table. */
function FieldSearch({ path, connection, onPick }: {
  path: string; connection: string; onPick: (hit: SemanticFieldHit) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SemanticFieldHit[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const debounced = useCallback((next: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      const results = next.trim() ? await searchFields(path, connection, next) : [];
      if (mine === seq.current) { setHits(results); setOpen(results.length > 0); }
    }, 250);
  }, [path, connection]);

  return (
    <Box position="relative">
      <HStack gap={1.5} px={2} bg="bg.surface" borderRadius="md" border="1px solid" borderColor="border.muted">
        <LuSearch size={13} color="var(--chakra-colors-fg-subtle)" />
        <Input
          aria-label="Semantic field search"
          variant="subtle"
          bg="transparent"
          size="sm"
          fontFamily="mono"
          fontSize="xs"
          border="none"
          placeholder="Search measures & dimensions across all tables…"
          value={q}
          onChange={(e) => { setQ(e.target.value); debounced(e.target.value); }}
          onFocus={() => setOpen(hits.length > 0)}
        />
      </HStack>
      {open && (
        <VStack
          position="absolute" top="100%" left={0} right={0} mt={1} zIndex={20}
          align="stretch" gap={0} maxH="260px" overflowY="auto"
          bg="bg.panel" border="1px solid" borderColor="border.muted" borderRadius="md" boxShadow="md"
        >
          {hits.map((h) => (
            <HStack
              key={`${h.kind}:${h.model}:${h.name}`}
              aria-label={`Search result ${h.kind}: ${h.name} (${h.model})`}
              as="button"
              px={2.5} py={1.5} gap={2}
              _hover={{ bg: 'bg.muted' }}
              onClick={() => { onPick(h); setOpen(false); setQ(''); setHits([]); }}
            >
              {h.kind === 'measure'
                ? <LuSigma size={12} color="var(--chakra-colors-accent-primary)" />
                : <LuGroup size={12} color="var(--chakra-colors-accent-warning)" />}
              <Text fontSize="xs" fontFamily="mono" flex={1} textAlign="left" truncate>{h.name}</Text>
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">{h.model}</Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
}

/** Filter add flow (dimension → operator → value), shared shape with the old builder. */
function SemanticFilterPicker({ dimensions, onAdd }: {
  dimensions: string[];
  onAdd: (filter: SemanticQueryFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dimension, setDimension] = useState('');
  const [operator, setOperator] = useState<SemanticQueryFilter['operator']>('=');
  const [value, setValue] = useState('');

  const close = () => { setOpen(false); setDimension(''); setOperator('='); setValue(''); };
  const needsValue = operator !== 'IS NULL' && operator !== 'IS NOT NULL';

  const submit = () => {
    if (!dimension || (needsValue && !value.trim())) return;
    const parsed: SemanticQueryFilter['value'] = !needsValue ? undefined
      : operator === 'IN' ? value.split(',').map((v) => v.trim()).filter(Boolean)
      : value.trim() !== '' && !isNaN(Number(value)) ? Number(value)
      : value;
    onAdd({ dimension, operator, ...(parsed !== undefined ? { value: parsed } : {}) });
    close();
  };

  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => { if (!details.open) close(); else setOpen(true); }}
      trigger={
        <Box aria-label="Add semantic filter">
          <AddChipButton onClick={() => setOpen(true)} variant="filter" />
        </Box>
      }
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
