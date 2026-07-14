'use client';

/**
 * SemanticCanvas — the semantic query editor (the Semantic tab).
 *
 * Two panes:
 *  - LEFT (the picker, scrolls independently): the FULL field list of the
 *    current model — measures, dimensions, time — always visible. The search
 *    bar on top FILTERS this list as you type (it shrinks), and additionally
 *    surfaces matching fields from OTHER whitelisted tables (server search,
 *    POST /api/semantic-models {q}) — picking one of those switches the model.
 *    With no model picked yet, the picker lists every whitelisted table to
 *    browse, so there is never a blank screen.
 *  - RIGHT (static, never scrolls away): what's currently selected — measure/
 *    dimension chips (removable), the time grain, filters, limit, execute.
 *
 * Interaction is CLICK-TO-TOGGLE — no drag and drop. Every field has exactly
 * one home (measure → Measures, dimension → Dimensions, time → Time), so a
 * click is unambiguous; dragging would add ceremony without choices.
 *
 * Every edit compiles the spec to dialect SQL client-side
 * (compileSemanticQuery → irToSqlLocal) and emits `(spec, sql, viz)` — the viz
 * columns are implied by the spec (x = time else dimensions, y = measures).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, VStack, HStack, Text, Button, Input, Icon } from '@chakra-ui/react';
import { LuPlay, LuSigma, LuGroup, LuClock, LuSearch, LuTriangleAlert, LuX, LuTable, LuCheck } from 'react-icons/lu';
import { compileSemanticQuery, validateSemanticQuery, semanticAlias } from '@/lib/semantic/compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { searchFields, type SemanticFieldHit } from '@/lib/semantic/models-client';
import type { ModelStub } from '@/lib/semantic/derive';
import type { SemanticModel, SemanticTimeGrain, VizSettings } from '@/lib/types';
import type { SemanticQuerySpec, SemanticQueryFilter } from '@/lib/validation/atlas-schemas';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
import { AddChipButton } from './QueryChip';

const TIME_GRAINS: SemanticTimeGrain[] = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];
const OPERATORS: SemanticQueryFilter['operator'][] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL'];

/** The viz assignment implied by the spec. */
export interface SemanticVizAssignment {
  type: VizSettings['type'];
  xCols: string[];
  yCols: string[];
}

interface SemanticCanvasProps {
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
  /** Persisted spec from content.semanticQuery, if any. */
  value: SemanticQuerySpec | null | undefined;
  /** Emits the edited spec, the SQL compiled from it, and the implied viz. */
  onChange: (spec: SemanticQuerySpec, sql: string, viz: SemanticVizAssignment) => void;
  onExecute?: () => void;
  isExecuting?: boolean;
}

const specForStub = (stub: ModelStub): SemanticQuerySpec => ({
  model: stub.name,
  table: stub.table,
  ...(stub.schema ? { schema: stub.schema } : {}),
  measures: [],
  dimensions: [],
});

const vizOf = (spec: SemanticQuerySpec): SemanticVizAssignment => {
  const xCols = [
    ...(spec.timeGrain ? [spec.timeGrain.toLowerCase()] : []),
    ...spec.dimensions.map(semanticAlias),
  ];
  return {
    type: spec.timeGrain ? 'line' : xCols.length > 0 ? 'bar' : 'table',
    xCols,
    yCols: spec.measures.map(semanticAlias),
  };
};

const matches = (q: string, name: string) => {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((t) => name.toLowerCase().includes(t));
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
  const [browsingTables, setBrowsingTables] = useState(false);
  const [query, setQuery] = useState('');
  const [otherHits, setOtherHits] = useState<SemanticFieldHit[]>([]);
  const searchSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const model = spec ? models.find((m) => m.name === spec.model) : undefined;
  const issues = spec && model ? validateSemanticQuery(spec, model) : [];

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

  // --- toggles ----------------------------------------------------------------

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

  // --- cross-table search (feeds the "Other tables" section of the picker) ----

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

  // --- left pane (the picker) ---------------------------------------------------

  const searchBar = (
    <HStack gap={1.5} px={2} bg="bg.surface" borderRadius="md" border="1px solid" borderColor="border.muted" flexShrink={0}>
      <LuSearch size={13} color="var(--chakra-colors-fg-subtle)" />
      <Input
        aria-label="Semantic field search"
        variant="subtle"
        bg="transparent"
        size="sm"
        fontFamily="mono"
        fontSize="xs"
        border="none"
        placeholder={model ? 'Filter measures & dimensions…' : 'Search fields across all tables…'}
        value={query}
        onChange={(e) => runSearch(e.target.value)}
      />
    </HStack>
  );

  const fieldRow = (label: string, assigned: boolean, icon: React.ReactNode, onClick: () => void, ariaLabel: string) => (
    <HStack
      key={ariaLabel}
      aria-label={ariaLabel}
      as="button"
      gap={1.5} px={2} py={1}
      bg={assigned ? 'accent.teal/10' : 'transparent'}
      borderRadius="md" border="1px solid"
      borderColor={assigned ? 'accent.teal' : 'border.default'}
      cursor="pointer"
      _hover={{ bg: assigned ? 'accent.teal/15' : 'bg.muted' }}
      onClick={onClick}
      userSelect="none"
      width="100%"
      textAlign="left"
      flexShrink={0}
    >
      {icon}
      <Text fontSize="xs" fontFamily="mono" truncate flex={1}>{label}</Text>
      {assigned && <LuCheck size={12} color="var(--chakra-colors-accent-teal)" />}
    </HStack>
  );

  const sectionHeader = (label: string) => (
    <Text key={`hdr-${label}`} fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" flexShrink={0}>
      {label}
    </Text>
  );

  // The effective time axis (spec.timeColumn overrides the model default).
  const effectiveTimeColumn = spec?.timeColumn ?? model?.timeDimension?.column;
  const timeLabel = model
    ? (model.dimensions.find((d) => d.column === effectiveTimeColumn && !d.join)?.name
        ?? model.timeDimension?.label ?? model.timeDimension?.column ?? 'Time')
    : 'Time';

  // Model picked: full field list, filtered (shrunk) by the query. Temporal
  // base columns render as time rows (clock) — clicking one makes it the axis.
  const visibleMeasures = model ? model.measures.filter((m) => matches(query, m.name)) : [];
  const temporalDims = model ? model.dimensions.filter((d) => d.temporal && !d.join) : [];
  const visibleTemporal = temporalDims.filter((d) => matches(query, d.name));
  // The model default may lack a dimension entry (hand-authored models) — give it a row.
  const defaultHasRow = !model?.timeDimension || temporalDims.some((d) => d.column === model.timeDimension!.column);
  const defaultTimeLabel = model?.timeDimension?.label ?? model?.timeDimension?.column ?? 'Time';
  const visibleDefaultTime = !defaultHasRow && !!model?.timeDimension && matches(query, defaultTimeLabel);
  const visibleDimensions = model
    ? model.dimensions.filter((d) => !(d.temporal && !d.join) && d.column !== model.timeDimension?.column && matches(query, d.name))
    : [];
  // Cross-table hits, minus the current model's own fields (already listed).
  const foreignHits = otherHits.filter((h) => h.model !== spec?.model).slice(0, 20);

  const picker = (
    <VStack align="stretch" gap={2} w="240px" flexShrink={0} minH={0} maxH="100%">
      {searchBar}
      {spec && (
        <HStack
          as="button"
          aria-label="Change table"
          gap={1.5} px={2} py={1}
          borderRadius="md" border="1px solid" borderColor="border.muted"
          bg={browsingTables ? 'bg.muted' : 'bg.surface'}
          _hover={{ bg: 'bg.muted' }}
          onClick={() => setBrowsingTables((b) => !b)}
          flexShrink={0}
          title="Pick a different table (starts a fresh query)"
        >
          <Icon as={LuTable} boxSize={3} color="fg.muted" flexShrink={0} />
          <Text fontSize="xs" fontFamily="mono" truncate flex={1} textAlign="left">{spec.model}</Text>
          <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">change ▾</Text>
        </HStack>
      )}
      <VStack align="stretch" gap={1.5} overflowY="auto" minH={0} flex={1} pr={1}>
        {!spec || browsingTables ? (
          <>
            {sectionHeader('Tables')}
            {stubs
              .filter((st) => matches(query, st.name))
              .slice(0, 200)
              .map((st) => fieldRow(
                st.name, false,
                <Icon as={LuTable} boxSize={3} color="fg.muted" flexShrink={0} />,
                () => pickStub(st),
                `Pick table: ${st.name}`,
              ))}
          </>
        ) : !model ? (
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">Loading {spec.model}…</Text>
        ) : (
          <>
            {visibleMeasures.length > 0 && sectionHeader('Measures')}
            {visibleMeasures.map((m) => fieldRow(
              m.name,
              spec.measures.includes(m.name),
              <LuSigma size={12} color="var(--chakra-colors-accent-primary)" />,
              () => toggleMeasure(m.name),
              `Field measure: ${m.name}`,
            ))}
            {(visibleDimensions.length > 0 || visibleTemporal.length > 0 || visibleDefaultTime) && sectionHeader('Dimensions')}
            {visibleDefaultTime && fieldRow(
              defaultTimeLabel,
              !!spec.timeGrain && effectiveTimeColumn === model.timeDimension!.column,
              <LuClock size={12} color="var(--chakra-colors-accent-secondary)" />,
              () => toggleTime(model.timeDimension!.column),
              `Field time: ${defaultTimeLabel}`,
            )}
            {visibleTemporal.map((d) => fieldRow(
              d.name,
              (!!spec.timeGrain && effectiveTimeColumn === d.column) || spec.dimensions.includes(d.name),
              <LuClock size={12} color="var(--chakra-colors-accent-secondary)" />,
              () => (spec.dimensions.includes(d.name) ? toggleDimension(d.name) : toggleTime(d.column)),
              `Field time: ${d.name}`,
            ))}
            {visibleDimensions.map((d) => fieldRow(
              d.name,
              spec.dimensions.includes(d.name),
              <LuGroup size={12} color="var(--chakra-colors-accent-warning)" />,
              () => toggleDimension(d.name),
              `Field dimension: ${d.name}`,
            ))}
          </>
        )}
        {foreignHits.length > 0 && (
          <>
            {sectionHeader('Other tables')}
            {foreignHits.map((h) => (
              <HStack
                key={`${h.kind}:${h.model}:${h.name}`}
                aria-label={`Other table field ${h.kind}: ${h.name} (${h.model})`}
                as="button"
                gap={1.5} px={2} py={1}
                borderRadius="md" border="1px dashed" borderColor="border.muted"
                _hover={{ bg: 'bg.muted' }}
                onClick={() => pickOtherHit(h)}
                width="100%"
                textAlign="left"
                flexShrink={0}
              >
                {h.kind === 'measure'
                  ? <LuSigma size={12} color="var(--chakra-colors-accent-primary)" />
                  : <LuGroup size={12} color="var(--chakra-colors-accent-warning)" />}
                <Text fontSize="xs" fontFamily="mono" flex={1} truncate>{h.name}</Text>
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate maxW="90px">{h.model}</Text>
              </HStack>
            ))}
          </>
        )}
      </VStack>
    </VStack>
  );

  // --- right pane (static selection summary) -----------------------------------

  const selection = !spec ? (
    <VStack align="stretch" gap={2} flex={1} minW={0} pt={8}>
      <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textAlign="center">
        Pick a table on the left, or search for a measure or dimension.
      </Text>
    </VStack>
  ) : (
    <VStack align="stretch" gap={3} flex={1} minW={0} overflowY="auto">
      <Box>
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
          {spec.model}
        </Text>
        <SelectionGroup label="Measures">
          {spec.measures.map((name) => (
            <ShelfChip
              key={name}
              label={`Measures chip: ${name}`}
              onRemove={spec.measures.length > 1 ? () => update({ measures: spec.measures.filter((m) => m !== name) }) : undefined}
            >
              <Text fontSize="xs" fontFamily="mono">{name}</Text>
            </ShelfChip>
          ))}
        </SelectionGroup>
        <SelectionGroup label="Dimensions">
          {spec.dimensions.map((name) => (
            <ShelfChip
              key={name}
              label={`Dimensions chip: ${name}`}
              onRemove={() => update({ dimensions: spec.dimensions.filter((d) => d !== name) })}
            >
              <Text fontSize="xs" fontFamily="mono">{name}</Text>
            </ShelfChip>
          ))}
        </SelectionGroup>
        {model?.timeDimension && (
          <SelectionGroup label="Time">
            {spec.timeGrain && (
              <ShelfChip label={`Time chip: ${timeLabel}`} onRemove={() => update({ timeGrain: undefined })}>
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
          </SelectionGroup>
        )}
        <SelectionGroup label="Filters">
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
          {model && (
            <SemanticFilterPicker
              dimensions={model.dimensions.map((d) => d.name)}
              onAdd={(filter) => update({ filters: [...(spec.filters ?? []), filter] })}
            />
          )}
        </SelectionGroup>
      </Box>

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
  );

  return (
    <HStack align="stretch" gap={3} p={4} h="100%" minH={0}>
      {picker}
      {selection}
    </HStack>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SelectionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box mb={3}>
      <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
        {label}
      </Text>
      <HStack gap={1.5} flexWrap="wrap" minH="26px">
        {children}
      </HStack>
    </Box>
  );
}

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

/** Filter add flow (dimension → operator → value). */
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
