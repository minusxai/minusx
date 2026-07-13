'use client';

/**
 * SemanticModelsTabContent — context-editor tab for authoring semantic models.
 *
 * Two very different renderings:
 *  - VIEW mode: a typography-only spec card. No form controls — each model is
 *    shown as an aligned definition list (`Revenue = SUM(total)`,
 *    `Status ← status`, `AOV = Revenue / Count`). Empty sections are omitted.
 *  - EDIT mode: a progressive, guided editor. Pick the base table first
 *    (searchable picker); the sections then appear with SUGGESTIONS derived
 *    from column types (temporal → time chips, categorical/text → dimension
 *    chips, numeric → measure chips) that one-click-add with Title-Cased
 *    names. Metrics only appear once two measures exist; joins sit behind an
 *    "add join" affordance. Live validation (validateSemanticModels) renders
 *    at the card footer, and the same check blocks context save — a persisted
 *    model is always complete.
 */

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Tabs, Box, Grid, VStack, HStack, Text, Input, Button, IconButton, Badge } from '@chakra-ui/react';
import { LuPlus, LuTrash2, LuSparkles, LuTable, LuTriangleAlert, LuClock, LuGroup, LuSigma, LuDivide, LuMerge } from 'react-icons/lu';
import type { ContextContent, DatabaseWithSchema, SemanticModel, SemanticAggregate, SemanticMeasure, SemanticJoinRelationship } from '@/lib/types';
import { validateSemanticModels } from '@/lib/semantic/validate-models';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from '@/components/query-builder';
import { CompletionsAPI } from '@/lib/data/completions/completions';

// ---------------------------------------------------------------------------
// Column/table helpers
// ---------------------------------------------------------------------------

interface ColumnInfo { name: string; type?: string; meta?: { category?: string } }

interface TableInfo {
  connection: string;
  schema?: string;
  table: string;
  columns: ColumnInfo[];
}

const tableKey = (t: { connection: string; schema?: string; table: string }) =>
  `${t.connection}|${t.schema ?? ''}|${t.table}`;

const tableLabel = (t: { schema?: string; table: string }) =>
  t.schema ? `${t.schema}.${t.table}` : t.table;

function collectTables(databases: DatabaseWithSchema[]): TableInfo[] {
  const tables: TableInfo[] = [];
  for (const db of databases) {
    for (const schema of db.schemas ?? []) {
      for (const table of schema.tables ?? []) {
        tables.push({
          connection: db.databaseName,
          schema: schema.schema || undefined,
          table: table.table,
          columns: (table.columns ?? []) as ColumnInfo[],
        });
      }
    }
  }
  return tables;
}

const isTemporal = (c: ColumnInfo) =>
  c.meta?.category === 'temporal' || /date|time|timestamp/i.test(c.type ?? '');
const isNumeric = (c: ColumnInfo) =>
  c.meta?.category === 'numeric' || /int|float|double|decimal|numeric|real|number/i.test(c.type ?? '');
const isCategorical = (c: ColumnInfo) =>
  c.meta?.category === 'categorical' || /char|text|string|bool|enum/i.test(c.type ?? '');

/** `order_status` → `Order Status` */
const titleCase = (column: string): string =>
  column
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const AGGS: SemanticAggregate[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT'];

// Semantic joins are dimension LOOKUPS (each base row matches at most one
// joined row) so base-table measures can never fan out. *-to-many joins are
// deliberately not offered — they'd silently inflate every SUM/COUNT.
const RELATIONSHIPS: Array<{ value: SemanticJoinRelationship; label: string }> = [
  { value: 'many_to_one', label: 'many : one' },
  { value: 'one_to_one', label: 'one : one' },
];

const measureFormula = (m: SemanticMeasure): string =>
  m.agg === 'COUNT' && !m.column ? 'COUNT(*)'
    : m.agg === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${m.column ?? '?'})`
    : `${m.agg}(${m.column ?? '?'})`;

// Shared control style: everything in an editing row is exactly 28px tall.
const CONTROL_H = '28px';
const selectStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'var(--font-jetbrains-mono), monospace',
  padding: '0 6px',
  border: '1px solid var(--chakra-colors-border-muted)',
  borderRadius: '6px',
  background: 'var(--chakra-colors-bg-canvas)',
  color: 'var(--chakra-colors-fg-default)',
  outline: 'none',
  height: CONTROL_H,
  cursor: 'pointer',
  width: '100%',
  minWidth: 0,
};

// ---------------------------------------------------------------------------
// Tab content
// ---------------------------------------------------------------------------

interface SemanticModelsTabContentProps {
  content: ContextContent;
  onChange: (updates: Partial<ContextContent>) => void;
  editMode: boolean;
  availableDatabases: DatabaseWithSchema[];
}

export function SemanticModelsTabContent({ content, onChange, editMode, availableDatabases }: SemanticModelsTabContentProps) {
  const models = content.semanticModels ?? [];
  const inherited = content.fullSemanticModels ?? [];
  const allTables = useMemo(() => collectTables(availableDatabases), [availableDatabases]);

  const setModels = (next: SemanticModel[]) => onChange({ semanticModels: next });

  const addModel = () => {
    setModels([
      ...models,
      // Deliberately empty: the editor guides table-first, then suggests the rest.
      { name: '', connection: '', table: '', dimensions: [], measures: [] },
    ]);
  };

  return (
    <Tabs.Content value="semantic">
      <VStack align="stretch" gap={3} py={2}>
        <HStack justify="space-between">
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Curated measures, dimensions and joins per table — powers the Semantic query mode.
          </Text>
          {editMode && (
            <Button aria-label="Add semantic model" size="xs" variant="outline" onClick={addModel} disabled={allTables.length === 0}>
              <LuPlus /> Add model
            </Button>
          )}
        </HStack>

        {inherited.map((model, i) => (
          <ModelSpecCard key={`inh-${i}`} model={model} inherited />
        ))}

        {models.map((model, idx) =>
          editMode ? (
            <ModelEditorCard
              key={idx}
              model={model}
              allTables={allTables}
              onChange={(next) => setModels(models.map((m, i) => (i === idx ? next : m)))}
              onRemove={() => setModels(models.filter((_, i) => i !== idx))}
            />
          ) : (
            <ModelSpecCard key={idx} model={model} />
          )
        )}

        {models.length === 0 && inherited.length === 0 && (
          <Box p={8} textAlign="center" border="1px dashed" borderColor="border.muted" borderRadius="lg">
            <VStack gap={1}>
              <Box color="fg.subtle"><LuSparkles size={18} /></Box>
              <Text fontSize="sm" color="fg.muted" fontFamily="mono">
                No semantic models yet.
              </Text>
              <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
                {editMode
                  ? 'Add a model to give a table business-named measures and dimensions — it enables the Semantic query mode for this context.'
                  : 'Enter edit mode to add one.'}
              </Text>
            </VStack>
          </Box>
        )}
      </VStack>
    </Tabs.Content>
  );
}

// ---------------------------------------------------------------------------
// Shared layout: label rail + content rows
// ---------------------------------------------------------------------------

function RailRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <Grid templateColumns="110px 1fr" gap={3} alignItems="start">
      <HStack gap={1.5} pt="5px" color="fg.subtle">
        {icon}
        <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
          {label}
        </Text>
      </HStack>
      <Box minW={0}>{children}</Box>
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// VIEW mode: typography-only spec card
// ---------------------------------------------------------------------------

function DefRow({ name, def }: { name: string; def: string }) {
  return (
    <HStack gap={2} py="2px" align="baseline">
      <Text fontSize="xs" fontFamily="mono" fontWeight="600" color="fg.default" minW="140px">
        {name}
      </Text>
      <Text fontSize="xs" fontFamily="mono" color="fg.muted" truncate title={def}>
        {def}
      </Text>
    </HStack>
  );
}

function ModelSpecCard({ model, inherited }: { model: SemanticModel; inherited?: boolean }) {
  return (
    <Box border="1px solid" borderColor="border.muted" borderRadius="lg" bg="bg.subtle" overflow="hidden" opacity={inherited ? 0.8 : 1}>
      <HStack px={4} py={2.5} gap={2.5} borderBottom="1px solid" borderColor="border.muted" bg="bg.muted/40">
        <Box color="accent.teal"><LuSparkles size={14} /></Box>
        <Text fontSize="sm" fontFamily="mono" fontWeight="700">{model.name || 'Untitled model'}</Text>
        <HStack gap={1.5} color="fg.subtle">
          <LuTable size={12} />
          <Text fontSize="xs" fontFamily="mono">
            {model.connection} · {tableLabel(model)}
          </Text>
        </HStack>
        <Box flex={1} />
        {inherited && <Badge size="xs" colorPalette="teal" variant="subtle">inherited</Badge>}
      </HStack>

      <VStack align="stretch" gap={2.5} px={4} py={3}>
        {model.timeDimension && (
          <RailRow icon={<LuClock size={11} />} label="Time">
            <DefRow name={model.timeDimension.label ?? titleCase(model.timeDimension.column)} def={model.timeDimension.column} />
          </RailRow>
        )}
        {model.dimensions.length > 0 && (
          <RailRow icon={<LuGroup size={11} />} label="Dimensions">
            {model.dimensions.map((d, i) => (
              <DefRow key={i} name={d.name} def={d.join ? `${d.join}.${d.column}` : d.column} />
            ))}
          </RailRow>
        )}
        {model.measures.length > 0 && (
          <RailRow icon={<LuSigma size={11} />} label="Measures">
            {model.measures.map((m, i) => (
              <DefRow key={i} name={m.name} def={`= ${measureFormula(m)}`} />
            ))}
          </RailRow>
        )}
        {(model.metrics?.length ?? 0) > 0 && (
          <RailRow icon={<LuDivide size={11} />} label="Metrics">
            {model.metrics!.map((mt, i) => (
              <DefRow key={i} name={mt.name} def={`= ${mt.numerator} / ${mt.denominator}`} />
            ))}
          </RailRow>
        )}
        {(model.joins?.length ?? 0) > 0 && (
          <RailRow icon={<LuMerge size={11} />} label="Joins">
            {model.joins!.map((j, i) => (
              <DefRow
                key={i}
                name={`${j.alias} (${j.table})`}
                def={`${j.type ?? 'LEFT'} JOIN (${(j.relationship ?? 'many_to_one').replace('_', ' : ').replace('_', ' ')}) ON ${model.table}.${j.leftColumn} = ${j.alias}.${j.rightColumn}`}
              />
            ))}
          </RailRow>
        )}
      </VStack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// EDIT mode: progressive guided editor
// ---------------------------------------------------------------------------

/** Small dashed suggestion chip: one click adds the suggested field. */
function SuggestionChip({ label, ariaLabel, onClick }: { label: string; ariaLabel: string; onClick: () => void }) {
  return (
    <Box
      as="button"
      aria-label={ariaLabel}
      px={2}
      py={0.5}
      border="1px dashed"
      borderColor="border.emphasized"
      borderRadius="md"
      cursor="pointer"
      transition="all 0.15s ease"
      _hover={{ bg: 'bg.muted', borderStyle: 'solid', borderColor: 'accent.teal' }}
      onClick={onClick}
    >
      <Text fontSize="11px" fontFamily="mono" color="fg.muted">+ {label}</Text>
    </Box>
  );
}

/** Solid toggle chip (time-column selection). */
function ToggleChip({ label, ariaLabel, selected, onClick }: { label: string; ariaLabel: string; selected: boolean; onClick: () => void }) {
  return (
    <Box
      as="button"
      aria-label={ariaLabel}
      aria-pressed={selected}
      px={2}
      py={0.5}
      border="1px solid"
      borderColor={selected ? 'accent.teal' : 'border.muted'}
      bg={selected ? 'accent.teal/15' : 'transparent'}
      borderRadius="md"
      cursor="pointer"
      transition="all 0.15s ease"
      _hover={{ borderColor: 'accent.teal' }}
      onClick={onClick}
    >
      <Text fontSize="11px" fontFamily="mono" color={selected ? 'accent.teal' : 'fg.muted'} fontWeight={selected ? '700' : '400'}>
        {label}
      </Text>
    </Box>
  );
}

function TablePicker({ current, allTables, onSelect }: {
  current?: TableInfo;
  allTables: TableInfo[];
  onSelect: (t: TableInfo) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      trigger={
        <Box
          as="button"
          aria-label="Semantic model table"
          px={2}
          py={0.5}
          h={CONTROL_H}
          display="flex"
          alignItems="center"
          border="1px solid"
          borderColor={current ? 'border.muted' : 'accent.teal'}
          borderStyle={current ? 'solid' : 'dashed'}
          borderRadius="md"
          cursor="pointer"
          _hover={{ bg: 'bg.muted' }}
          onClick={() => setOpen(true)}
        >
          <HStack gap={1.5}>
            <Box color={current ? 'fg.muted' : 'accent.teal'}><LuTable size={12} /></Box>
            <Text fontSize="xs" fontFamily="mono" color={current ? 'fg.default' : 'accent.teal'}>
              {current ? `${current.connection} · ${tableLabel(current)}` : 'Choose a base table…'}
            </Text>
          </HStack>
        </Box>
      }
    >
      <PickerHeader>Base table</PickerHeader>
      <PickerList maxH="300px" searchable searchPlaceholder="Search tables...">
        {(query) => allTables
          .filter((t) => !query || tableLabel(t).toLowerCase().includes(query.toLowerCase()))
          .map((t) => (
            <PickerItem
              key={tableKey(t)}
              aria-label={`Base table ${tableLabel(t)}`}
              icon={<LuTable size={13} />}
              selected={!!current && tableKey(t) === tableKey(current)}
              onClick={() => { onSelect(t); setOpen(false); }}
            >
              <HStack justify="space-between" width="100%">
                <Text fontFamily="mono" fontSize="xs">{tableLabel(t)}</Text>
                <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">{t.connection}</Text>
              </HStack>
            </PickerItem>
          ))}
      </PickerList>
    </PickerPopover>
  );
}

function ModelEditorCard({ model, allTables, onChange, onRemove }: {
  model: SemanticModel;
  allTables: TableInfo[];
  onChange: (next: SemanticModel) => void;
  onRemove: () => void;
}) {
  // --- Buffered draft: typing edits stay local and flush debounced/on-blur.
  // Committing per keystroke re-merges the ENTIRE context content through
  // Redux (slow on real workspaces with large schemas) — never do that.
  const [draft, setDraftState] = useState(model);
  const draftRef = useRef(model);
  const lastFlushedRef = useRef(model);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // External replacement (cancel / version switch): reset the draft.
    if (JSON.stringify(model) !== JSON.stringify(lastFlushedRef.current)) {
      draftRef.current = model;
      lastFlushedRef.current = model;
      setDraftState(model);
    }
  }, [model]);

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (JSON.stringify(draftRef.current) !== JSON.stringify(lastFlushedRef.current)) {
      lastFlushedRef.current = draftRef.current;
      onChange(draftRef.current);
    }
  }, [onChange]);

  // Flush pending edits on unmount so nothing is lost.
  useEffect(() => () => flush(), [flush]);

  const set = (updates: Partial<SemanticModel>) => {
    const next = { ...draftRef.current, ...updates };
    draftRef.current = next;
    setDraftState(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 400);
  };

  // --- Columns: fetched on demand per table. The context document's schema is
  // BOUNDED for large workspaces (boundFullSchema drops columns), so the local
  // copy in allTables may be empty — the completions API always has them.
  const [columnsByTable, setColumnsByTable] = useState<Record<string, ColumnInfo[]>>({});
  const baseKey = draft.table ? tableKey(draft) : null;
  const joinKeys = (draft.joins ?? [])
    .filter((j) => j.table)
    .map((j) => tableKey({ connection: draft.connection, schema: j.schema, table: j.table }));
  const wantedKeys = [baseKey, ...joinKeys].filter((k): k is string => !!k).join(';');

  useEffect(() => {
    let cancelled = false;
    for (const key of wantedKeys.split(';').filter(Boolean)) {
      if (columnsByTable[key]) continue;
      const [connection, schema, table] = key.split('|');
      const local = allTables.find((t) => tableKey(t) === key)?.columns;
      if (local && local.length > 0) {
        setColumnsByTable((prev) => (prev[key] ? prev : { ...prev, [key]: local }));
        continue;
      }
      CompletionsAPI.getColumnSuggestions({ databaseName: connection, table, schema: schema || undefined })
        .then((res) => {
          if (!cancelled && res.success && res.columns) {
            setColumnsByTable((prev) => ({ ...prev, [key]: res.columns as ColumnInfo[] }));
          }
        })
        .catch(() => { /* selects just stay empty */ });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKeys, allTables]);

  const baseTable = allTables.find((t) => baseKey && tableKey(t) === baseKey);
  const baseColumns = (baseKey && columnsByTable[baseKey]) || [];
  const columnsLoading = !!baseKey && !columnsByTable[baseKey];
  const issues = validateSemanticModels([draft]);

  const columnsForJoin = (alias?: string): ColumnInfo[] => {
    if (!alias) return baseColumns;
    const join = (draft.joins ?? []).find((j) => j.alias === alias);
    if (!join?.table) return [];
    return columnsByTable[tableKey({ connection: draft.connection, schema: join.schema, table: join.table })] ?? [];
  };

  // Suggestions: columns not already used by the section, classified by type.
  const usedDimensionColumns = new Set(draft.dimensions.filter((d) => !d.join).map((d) => d.column));
  const usedMeasureColumns = new Set(draft.measures.map((m) => m.column).filter(Boolean));
  const temporalColumns = baseColumns.filter(isTemporal);
  const dimensionSuggestions = baseColumns
    .filter((c) => isCategorical(c) && !usedDimensionColumns.has(c.name))
    .slice(0, 6);
  const measureSuggestions = baseColumns
    // id-like columns are numeric but summing them is meaningless — keep them
    // out of the suggestions (still reachable via "custom").
    .filter((c) => isNumeric(c) && !usedMeasureColumns.has(c.name) && !/(^|_)id$/i.test(c.name))
    .slice(0, 6);
  const hasCount = draft.measures.some((m) => m.agg === 'COUNT' && !m.column);
  const namedMeasures = draft.measures.filter((m) => m.name.trim());

  const handleTableSelect = (t: TableInfo) => {
    // Changing the base table invalidates all column-bound config; re-seed
    // with the model's name defaulted from the table and a Count measure.
    // Discrete action → commit immediately (no debounce).
    set({
      name: draftRef.current.name.trim() || titleCase(t.table),
      connection: t.connection,
      schema: t.schema,
      table: t.table,
      timeDimension: undefined,
      dimensions: [],
      measures: [{ name: 'Count', agg: 'COUNT' }],
      joins: [],
      metrics: [],
    });
    flush();
  };

  return (
    <Box border="1px solid" borderColor="border.muted" borderRadius="lg" bg="bg.subtle" overflow="hidden" onBlurCapture={flush}>
      {/* Header: name + table + delete */}
      <HStack px={4} py={2.5} gap={2.5} borderBottom="1px solid" borderColor="border.muted" bg="bg.muted/40">
        <Box color="accent.teal" flexShrink={0}><LuSparkles size={14} /></Box>
        <Input
          aria-label="Semantic model name"
          size="xs"
          h={CONTROL_H}
          fontFamily="mono"
          fontWeight="600"
          maxW="220px"
          value={draft.name}
          placeholder="Model name"
          onChange={(e) => set({ name: e.target.value })}
        />
        <TablePicker current={baseTable} allTables={allTables} onSelect={handleTableSelect} />
        <Box flex={1} />
        <IconButton aria-label="Delete semantic model" size="xs" variant="ghost" colorPalette="red" onClick={onRemove}>
          <LuTrash2 size={14} />
        </IconButton>
      </HStack>

      {!baseTable ? (
        <Box px={4} py={5}>
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
            Pick the base table — measures, dimensions and the time axis are defined on its columns.
          </Text>
        </Box>
      ) : (
        <VStack align="stretch" gap={3.5} px={4} py={3.5}>
          {/* TIME: toggle chips over temporal columns */}
          <RailRow icon={<LuClock size={11} />} label="Time">
            <HStack gap={1.5} flexWrap="wrap">
              <ToggleChip
                label="none"
                ariaLabel="Time column none"
                selected={!draft.timeDimension}
                onClick={() => set({ timeDimension: undefined })}
              />
              {temporalColumns.map((c) => (
                <ToggleChip
                  key={c.name}
                  label={c.name}
                  ariaLabel={`Time column ${c.name}`}
                  selected={draft.timeDimension?.column === c.name}
                  onClick={() => set({ timeDimension: { column: c.name } })}
                />
              ))}
              {columnsLoading ? (
                <Text fontSize="11px" color="fg.subtle" fontFamily="mono" pt="4px">
                  loading columns…
                </Text>
              ) : temporalColumns.length === 0 && (
                <Text fontSize="11px" color="fg.subtle" fontFamily="mono" pt="4px">
                  no date/time columns detected on {draft.table}
                </Text>
              )}
            </HStack>
          </RailRow>

          {/* DIMENSIONS */}
          <RailRow icon={<LuGroup size={11} />} label="Dimensions">
            <VStack align="stretch" gap={1.5}>
              {draft.dimensions.map((d, i) => (
                <Grid key={i} templateColumns="220px 130px 1fr 28px" gap={1.5} alignItems="center">
                  <Input
                    aria-label={`Dimension name ${i + 1}`}
                    size="xs" h={CONTROL_H} fontFamily="mono" placeholder="Business name"
                    value={d.name}
                    onChange={(e) => set({ dimensions: draft.dimensions.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}
                  />
                  <select
                    aria-label={`Dimension join ${i + 1}`}
                    style={selectStyle}
                    value={d.join ?? ''}
                    onChange={(e) => set({ dimensions: draft.dimensions.map((x, j) => j === i ? { ...x, join: e.target.value || undefined, column: '' } : x) })}
                  >
                    <option value="">{draft.table}</option>
                    {(draft.joins ?? []).map((j) => <option key={j.alias} value={j.alias}>{j.alias} ({j.table})</option>)}
                  </select>
                  <select
                    aria-label={`Dimension column ${i + 1}`}
                    style={selectStyle}
                    value={d.column}
                    onChange={(e) => set({ dimensions: draft.dimensions.map((x, j) => j === i ? { ...x, column: e.target.value } : x) })}
                  >
                    <option value="">{columnsForJoin(d.join).length === 0 ? 'loading columns…' : 'column…'}</option>
                    {columnsForJoin(d.join).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                  <IconButton aria-label={`Remove dimension ${i + 1}`} size="2xs" variant="ghost"
                    onClick={() => set({ dimensions: draft.dimensions.filter((_, j) => j !== i) })}>
                    <LuTrash2 size={12} />
                  </IconButton>
                </Grid>
              ))}
              <HStack gap={1.5} flexWrap="wrap">
                {dimensionSuggestions.map((c) => (
                  <SuggestionChip
                    key={c.name}
                    label={c.name}
                    ariaLabel={`Suggested dimension ${c.name}`}
                    onClick={() => set({ dimensions: [...draft.dimensions, { name: titleCase(c.name), column: c.name }] })}
                  />
                ))}
                <Button aria-label="Add dimension" size="2xs" variant="ghost" color="fg.subtle"
                  onClick={() => set({ dimensions: [...draft.dimensions, { name: '', column: '' }] })}>
                  <LuPlus size={11} /> custom
                </Button>
              </HStack>
            </VStack>
          </RailRow>

          {/* MEASURES */}
          <RailRow icon={<LuSigma size={11} />} label="Measures">
            <VStack align="stretch" gap={1.5}>
              {draft.measures.map((m, i) => (
                <Grid key={i} templateColumns="220px 130px 1fr 28px" gap={1.5} alignItems="center">
                  <Input
                    aria-label={`Measure name ${i + 1}`}
                    size="xs" h={CONTROL_H} fontFamily="mono" placeholder="Business name"
                    value={m.name}
                    onChange={(e) => set({ measures: draft.measures.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}
                  />
                  <select
                    aria-label={`Measure aggregation ${i + 1}`}
                    style={selectStyle}
                    value={m.agg}
                    onChange={(e) => {
                      const agg = e.target.value as SemanticAggregate;
                      set({ measures: draft.measures.map((x, j) => j === i ? { ...x, agg, ...(agg === 'COUNT' ? { column: undefined } : {}) } : x) });
                    }}
                  >
                    {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  {m.agg === 'COUNT' ? (
                    <Text fontSize="xs" color="fg.subtle" fontFamily="mono" pl={1}>all rows</Text>
                  ) : (
                    <select
                      aria-label={`Measure column ${i + 1}`}
                      style={selectStyle}
                      value={m.column ?? ''}
                      onChange={(e) => set({ measures: draft.measures.map((x, j) => j === i ? { ...x, column: e.target.value || undefined } : x) })}
                    >
                      <option value="">{baseColumns.length === 0 ? 'loading columns…' : 'column…'}</option>
                      {baseColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  )}
                  <IconButton aria-label={`Remove measure ${i + 1}`} size="2xs" variant="ghost"
                    onClick={() => set({ measures: draft.measures.filter((_, j) => j !== i) })}>
                    <LuTrash2 size={12} />
                  </IconButton>
                </Grid>
              ))}
              <HStack gap={1.5} flexWrap="wrap">
                {!hasCount && (
                  <SuggestionChip
                    label="Count of rows"
                    ariaLabel="Suggested measure count of rows"
                    onClick={() => set({ measures: [...draft.measures, { name: 'Count', agg: 'COUNT' }] })}
                  />
                )}
                {measureSuggestions.map((c) => (
                  <SuggestionChip
                    key={c.name}
                    label={`SUM ${c.name}`}
                    ariaLabel={`Suggested measure sum of ${c.name}`}
                    onClick={() => set({ measures: [...draft.measures, { name: titleCase(c.name), agg: 'SUM', column: c.name }] })}
                  />
                ))}
                <Button aria-label="Add measure" size="2xs" variant="ghost" color="fg.subtle"
                  onClick={() => set({ measures: [...draft.measures, { name: '', agg: 'SUM' }] })}>
                  <LuPlus size={11} /> custom
                </Button>
              </HStack>
            </VStack>
          </RailRow>

          {/* METRICS — progressive: needs two named measures to compose */}
          {namedMeasures.length >= 2 && (
            <RailRow icon={<LuDivide size={11} />} label="Metrics">
              <VStack align="stretch" gap={1.5}>
                {(draft.metrics ?? []).map((mt, i) => (
                  <Grid key={i} templateColumns="220px 1fr 16px 1fr 28px" gap={1.5} alignItems="center">
                    <Input
                      aria-label={`Metric name ${i + 1}`}
                      size="xs" h={CONTROL_H} fontFamily="mono" placeholder="Business name"
                      value={mt.name}
                      onChange={(e) => set({ metrics: (draft.metrics ?? []).map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}
                    />
                    <select
                      aria-label={`Metric numerator ${i + 1}`}
                      style={selectStyle}
                      value={mt.numerator}
                      onChange={(e) => set({ metrics: (draft.metrics ?? []).map((x, j) => j === i ? { ...x, numerator: e.target.value } : x) })}
                    >
                      <option value="">numerator…</option>
                      {namedMeasures.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                    </select>
                    <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textAlign="center">/</Text>
                    <select
                      aria-label={`Metric denominator ${i + 1}`}
                      style={selectStyle}
                      value={mt.denominator}
                      onChange={(e) => set({ metrics: (draft.metrics ?? []).map((x, j) => j === i ? { ...x, denominator: e.target.value } : x) })}
                    >
                      <option value="">denominator…</option>
                      {namedMeasures.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                    </select>
                    <IconButton aria-label={`Remove metric ${i + 1}`} size="2xs" variant="ghost"
                      onClick={() => set({ metrics: (draft.metrics ?? []).filter((_, j) => j !== i) })}>
                      <LuTrash2 size={12} />
                    </IconButton>
                  </Grid>
                ))}
                <Box>
                  <Button aria-label="Add ratio metric" size="2xs" variant="ghost" color="fg.subtle"
                    onClick={() => set({ metrics: [...(draft.metrics ?? []), { name: '', type: 'ratio', numerator: '', denominator: '' }] })}>
                    <LuPlus size={11} /> ratio metric (measure ÷ measure)
                  </Button>
                </Box>
              </VStack>
            </RailRow>
          )}

          {/* JOINS — advanced, tucked behind the add affordance */}
          <RailRow icon={<LuMerge size={11} />} label="Joins">
            <VStack align="stretch" gap={1.5}>
              {(draft.joins ?? []).map((jn, i) => (
                <Grid key={i} templateColumns="200px 80px 110px 1fr 16px 1fr 28px" gap={1.5} alignItems="center">
                  <select
                    aria-label={`Join table ${i + 1}`}
                    style={selectStyle}
                    value={jn.table ? tableKey({ connection: draft.connection, schema: jn.schema, table: jn.table }) : ''}
                    onChange={(e) => {
                      const t = allTables.find((x) => tableKey(x) === e.target.value);
                      if (t) set({ joins: (draft.joins ?? []).map((x, j) => j === i ? { ...x, table: t.table, schema: t.schema, alias: x.alias || t.table.slice(0, 2) } : x) });
                    }}
                  >
                    <option value="">join table…</option>
                    {allTables.filter((t) => t.connection === draft.connection && t.table !== draft.table).map((t) => (
                      <option key={tableKey(t)} value={tableKey(t)}>{tableLabel(t)}</option>
                    ))}
                  </select>
                  <Input
                    aria-label={`Join alias ${i + 1}`}
                    size="xs" h={CONTROL_H} fontFamily="mono" placeholder="alias"
                    value={jn.alias}
                    onChange={(e) => set({ joins: (draft.joins ?? []).map((x, j) => j === i ? { ...x, alias: e.target.value } : x) })}
                  />
                  <select
                    aria-label={`Join relationship ${i + 1}`}
                    title="Cardinality from the base table's perspective — semantic joins must be lookups (at most one joined row per base row) so measures never fan out"
                    style={selectStyle}
                    value={jn.relationship ?? 'many_to_one'}
                    onChange={(e) => set({ joins: (draft.joins ?? []).map((x, j) => j === i ? { ...x, relationship: e.target.value as SemanticJoinRelationship } : x) })}
                  >
                    {RELATIONSHIPS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <select
                    aria-label={`Join left column ${i + 1}`}
                    style={selectStyle}
                    value={jn.leftColumn}
                    onChange={(e) => set({ joins: (draft.joins ?? []).map((x, j) => j === i ? { ...x, leftColumn: e.target.value } : x) })}
                  >
                    <option value="">{draft.table} column…</option>
                    {baseColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                  <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textAlign="center">=</Text>
                  <select
                    aria-label={`Join right column ${i + 1}`}
                    style={selectStyle}
                    value={jn.rightColumn}
                    onChange={(e) => set({ joins: (draft.joins ?? []).map((x, j) => j === i ? { ...x, rightColumn: e.target.value } : x) })}
                  >
                    <option value="">{jn.table || 'joined'} column…</option>
                    {(jn.table ? (columnsByTable[tableKey({ connection: draft.connection, schema: jn.schema, table: jn.table })] ?? []) : []).map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <IconButton aria-label={`Remove join ${i + 1}`} size="2xs" variant="ghost"
                    onClick={() => set({ joins: (draft.joins ?? []).filter((_, j) => j !== i) })}>
                    <LuTrash2 size={12} />
                  </IconButton>
                </Grid>
              ))}
              <Box>
                <Button aria-label="Add join" size="2xs" variant="ghost" color="fg.subtle"
                  onClick={() => set({ joins: [...(draft.joins ?? []), { table: '', alias: '', leftColumn: '', rightColumn: '' }] })}>
                  <LuPlus size={11} /> join another table (enables cross-table dimensions)
                </Button>
                {(draft.joins ?? []).length > 0 && (
                  <Text fontSize="10px" color="fg.subtle" fontFamily="mono" mt={0.5}>
                    joins are lookups: each {draft.table} row must match at most one joined row, so measures never double-count.
                    For one-to-many analysis, use the Full or SQL mode.
                  </Text>
                )}
              </Box>
            </VStack>
          </RailRow>

          {/* Live validation footer — same check that gates context save */}
          {issues.length > 0 && (
            <HStack gap={2} px={3} py={2} bg="orange.500/10" borderRadius="md" align="start">
              <Box color="orange.400" pt="1px"><LuTriangleAlert size={13} /></Box>
              <VStack align="start" gap={0.5}>
                {issues.slice(0, 4).map((issue, i) => (
                  <Text key={i} fontSize="11px" fontFamily="mono" color="orange.400">
                    {issue.replace(/^Semantic model "[^"]*": /, '')}
                  </Text>
                ))}
                {issues.length > 4 && (
                  <Text fontSize="11px" fontFamily="mono" color="orange.400">+{issues.length - 4} more</Text>
                )}
              </VStack>
            </HStack>
          )}
        </VStack>
      )}
    </Box>
  );
}
