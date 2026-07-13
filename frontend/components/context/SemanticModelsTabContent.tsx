'use client';

/**
 * SemanticModelsTabContent — context-editor tab for authoring semantic models
 * (the Semantic query tier's configuration). Models live on the context
 * version (`semanticModels`), inherited like metrics/annotations; edits flow
 * through onChange({ semanticModels }) into the selected version.
 *
 * Each model card: base table + time column, then dimensions (business name →
 * column, optionally on a joined table), measures (name → agg(column)),
 * explicit joins, and ratio metrics composed from two measures.
 */

import React from 'react';
import { Tabs, Box, VStack, HStack, Text, Input, Button, IconButton, Badge } from '@chakra-ui/react';
import { LuPlus, LuTrash2, LuSparkles } from 'react-icons/lu';
import type { ContextContent, DatabaseWithSchema, SemanticModel, SemanticAggregate } from '@/lib/types';

const AGGS: SemanticAggregate[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT'];

const selectStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'var(--font-jetbrains-mono), monospace',
  padding: '3px 6px',
  border: '1px solid var(--chakra-colors-border-muted)',
  borderRadius: '4px',
  background: 'var(--chakra-colors-bg-canvas)',
  color: 'var(--chakra-colors-fg-default)',
  outline: 'none',
  height: '26px',
  cursor: 'pointer',
  maxWidth: '220px',
};

interface TableInfo {
  connection: string;
  schema?: string;
  table: string;
  columns: Array<{ name: string; type?: string }>;
}

interface SemanticModelsTabContentProps {
  content: ContextContent;
  onChange: (updates: Partial<ContextContent>) => void;
  editMode: boolean;
  availableDatabases: DatabaseWithSchema[];
}

const tableKey = (t: { connection: string; schema?: string; table: string }) =>
  `${t.connection}|${t.schema ?? ''}|${t.table}`;

function collectTables(databases: DatabaseWithSchema[]): TableInfo[] {
  const tables: TableInfo[] = [];
  for (const db of databases) {
    for (const schema of db.schemas ?? []) {
      for (const table of schema.tables ?? []) {
        tables.push({
          connection: db.databaseName,
          schema: schema.schema || undefined,
          table: table.table,
          columns: (table.columns ?? []).map((c) => ({ name: c.name, type: c.type })),
        });
      }
    }
  }
  return tables;
}

export function SemanticModelsTabContent({ content, onChange, editMode, availableDatabases }: SemanticModelsTabContentProps) {
  const models = content.semanticModels ?? [];
  const inherited = content.fullSemanticModels ?? [];
  const allTables = collectTables(availableDatabases);

  const setModels = (next: SemanticModel[]) => onChange({ semanticModels: next });
  const updateModel = (idx: number, next: SemanticModel) => setModels(models.map((m, i) => (i === idx ? next : m)));
  const removeModel = (idx: number) => setModels(models.filter((_, i) => i !== idx));

  const addModel = () => {
    const first = allTables[0];
    setModels([
      ...models,
      {
        name: `Model ${models.length + 1}`,
        connection: first?.connection ?? '',
        schema: first?.schema,
        table: first?.table ?? '',
        dimensions: [],
        measures: [{ name: 'Count', agg: 'COUNT' }],
      },
    ]);
  };

  return (
    <Tabs.Content value="semantic">
      <VStack align="stretch" gap={3} py={2}>
        <HStack justify="space-between">
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Semantic models power the Semantic query tab: curated measures, dimensions and joins per table.
          </Text>
          {editMode && (
            <Button aria-label="Add semantic model" size="xs" variant="outline" onClick={addModel} disabled={allTables.length === 0}>
              <LuPlus /> Add model
            </Button>
          )}
        </HStack>

        {inherited.map((model, i) => (
          <ModelCard key={`inh-${i}`} model={model} allTables={allTables} editMode={false} inherited />
        ))}
        {models.map((model, idx) => (
          <ModelCard
            key={idx}
            model={model}
            allTables={allTables}
            editMode={editMode}
            onChange={(next) => updateModel(idx, next)}
            onRemove={() => removeModel(idx)}
          />
        ))}
        {models.length === 0 && inherited.length === 0 && (
          <Box p={6} textAlign="center" border="1px dashed" borderColor="border.muted" borderRadius="lg">
            <Text fontSize="sm" color="fg.muted" fontFamily="mono">
              No semantic models yet. {editMode ? 'Add one to enable the Semantic query tab for this context.' : 'Enter edit mode to add one.'}
            </Text>
          </Box>
        )}
      </VStack>
    </Tabs.Content>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <HStack gap={2} align="center" flexWrap="wrap">
      <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" w="88px" flexShrink={0} fontFamily="mono">
        {label}
      </Text>
      {children}
    </HStack>
  );
}

function ModelCard({ model, allTables, editMode, inherited, onChange, onRemove }: {
  model: SemanticModel;
  allTables: TableInfo[];
  editMode: boolean;
  inherited?: boolean;
  onChange?: (next: SemanticModel) => void;
  onRemove?: () => void;
}) {
  const set = (updates: Partial<SemanticModel>) => onChange?.({ ...model, ...updates });
  const baseTable = allTables.find((t) => tableKey(t) === tableKey(model));
  const baseColumns = baseTable?.columns ?? [];
  const joinTables = model.joins ?? [];
  const columnsForJoin = (alias?: string): Array<{ name: string; type?: string }> => {
    if (!alias) return baseColumns;
    const join = joinTables.find((j) => j.alias === alias);
    const t = join && allTables.find((x) => x.connection === model.connection && x.table === join.table && (x.schema ?? '') === (join.schema ?? ''));
    return t?.columns ?? [];
  };

  const disabled = !editMode || inherited;

  return (
    <Box border="1px solid" borderColor="border.muted" borderRadius="lg" p={3} bg="bg.subtle" opacity={inherited ? 0.75 : 1}>
      <VStack align="stretch" gap={2.5}>
        <HStack justify="space-between" gap={2}>
          <HStack gap={2} flex={1} minW={0}>
            <Box color="accent.teal"><LuSparkles size={14} /></Box>
            <Input
              aria-label="Semantic model name"
              size="xs"
              fontFamily="mono"
              fontWeight="600"
              maxW="220px"
              value={model.name}
              disabled={disabled}
              onChange={(e) => set({ name: e.target.value })}
            />
            <select
              aria-label="Semantic model table"
              style={selectStyle}
              value={tableKey(model)}
              disabled={disabled}
              onChange={(e) => {
                const t = allTables.find((x) => tableKey(x) === e.target.value);
                if (t) {
                  // Changing the base table invalidates column-bound config.
                  set({
                    connection: t.connection, schema: t.schema, table: t.table,
                    timeDimension: undefined, dimensions: [], measures: [{ name: 'Count', agg: 'COUNT' }], joins: [], metrics: [],
                  });
                }
              }}
            >
              {!baseTable && <option value={tableKey(model)}>{model.table || 'select table'}</option>}
              {allTables.map((t) => (
                <option key={tableKey(t)} value={tableKey(t)}>
                  {t.connection} · {t.schema ? `${t.schema}.` : ''}{t.table}
                </option>
              ))}
            </select>
            {inherited && (
              <Badge size="xs" colorPalette="teal" variant="subtle">inherited</Badge>
            )}
          </HStack>
          {!disabled && (
            <IconButton aria-label="Delete semantic model" size="xs" variant="ghost" colorPalette="red" onClick={onRemove}>
              <LuTrash2 size={14} />
            </IconButton>
          )}
        </HStack>

        {/* Time dimension */}
        <Row label="Time">
          <select
            aria-label="Time dimension column"
            style={selectStyle}
            value={model.timeDimension?.column ?? ''}
            disabled={disabled}
            onChange={(e) => set({ timeDimension: e.target.value ? { column: e.target.value } : undefined })}
          >
            <option value="">none</option>
            {baseColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </Row>

        {/* Dimensions */}
        <Row label="Dimensions">
          <VStack align="stretch" gap={1} flex={1}>
            {model.dimensions.map((d, i) => (
              <HStack key={i} gap={1.5}>
                <Input
                  aria-label={`Dimension name ${i + 1}`}
                  size="xs" fontFamily="mono" maxW="160px" placeholder="Name"
                  value={d.name} disabled={disabled}
                  onChange={(e) => set({ dimensions: model.dimensions.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}
                />
                <select
                  aria-label={`Dimension join ${i + 1}`}
                  style={{ ...selectStyle, maxWidth: '110px' }}
                  value={d.join ?? ''} disabled={disabled}
                  onChange={(e) => set({ dimensions: model.dimensions.map((x, j) => j === i ? { ...x, join: e.target.value || undefined, column: '' } : x) })}
                >
                  <option value="">{model.table}</option>
                  {joinTables.map((j) => <option key={j.alias} value={j.alias}>{j.alias} ({j.table})</option>)}
                </select>
                <select
                  aria-label={`Dimension column ${i + 1}`}
                  style={selectStyle}
                  value={d.column} disabled={disabled}
                  onChange={(e) => set({ dimensions: model.dimensions.map((x, j) => j === i ? { ...x, column: e.target.value } : x) })}
                >
                  <option value="">column…</option>
                  {columnsForJoin(d.join).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                {!disabled && (
                  <IconButton aria-label={`Remove dimension ${i + 1}`} size="2xs" variant="ghost" onClick={() => set({ dimensions: model.dimensions.filter((_, j) => j !== i) })}>
                    <LuTrash2 size={12} />
                  </IconButton>
                )}
              </HStack>
            ))}
            {!disabled && (
              <Button aria-label="Add dimension" size="2xs" variant="ghost" alignSelf="start"
                onClick={() => set({ dimensions: [...model.dimensions, { name: '', column: '' }] })}>
                <LuPlus size={12} /> dimension
              </Button>
            )}
          </VStack>
        </Row>

        {/* Measures */}
        <Row label="Measures">
          <VStack align="stretch" gap={1} flex={1}>
            {model.measures.map((m, i) => (
              <HStack key={i} gap={1.5}>
                <Input
                  aria-label={`Measure name ${i + 1}`}
                  size="xs" fontFamily="mono" maxW="160px" placeholder="Name"
                  value={m.name} disabled={disabled}
                  onChange={(e) => set({ measures: model.measures.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}
                />
                <select
                  aria-label={`Measure aggregation ${i + 1}`}
                  style={{ ...selectStyle, maxWidth: '150px' }}
                  value={m.agg} disabled={disabled}
                  onChange={(e) => {
                    const agg = e.target.value as SemanticAggregate;
                    set({ measures: model.measures.map((x, j) => j === i ? { ...x, agg, ...(agg === 'COUNT' ? { column: undefined } : {}) } : x) });
                  }}
                >
                  {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                {m.agg !== 'COUNT' && (
                  <select
                    aria-label={`Measure column ${i + 1}`}
                    style={selectStyle}
                    value={m.column ?? ''} disabled={disabled}
                    onChange={(e) => set({ measures: model.measures.map((x, j) => j === i ? { ...x, column: e.target.value || undefined } : x) })}
                  >
                    <option value="">column…</option>
                    {baseColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                )}
                {!disabled && (
                  <IconButton aria-label={`Remove measure ${i + 1}`} size="2xs" variant="ghost" onClick={() => set({ measures: model.measures.filter((_, j) => j !== i) })}>
                    <LuTrash2 size={12} />
                  </IconButton>
                )}
              </HStack>
            ))}
            {!disabled && (
              <Button aria-label="Add measure" size="2xs" variant="ghost" alignSelf="start"
                onClick={() => set({ measures: [...model.measures, { name: '', agg: 'SUM' }] })}>
                <LuPlus size={12} /> measure
              </Button>
            )}
          </VStack>
        </Row>

        {/* Joins */}
        <Row label="Joins">
          <VStack align="stretch" gap={1} flex={1}>
            {(model.joins ?? []).map((jn, i) => {
              const joinTableInfo = allTables.find((x) => x.connection === model.connection && x.table === jn.table && (x.schema ?? '') === (jn.schema ?? ''));
              return (
                <HStack key={i} gap={1.5} flexWrap="wrap">
                  <select
                    aria-label={`Join table ${i + 1}`}
                    style={selectStyle}
                    value={jn.table ? tableKey({ connection: model.connection, schema: jn.schema, table: jn.table }) : ''}
                    disabled={disabled}
                    onChange={(e) => {
                      const t = allTables.find((x) => tableKey(x) === e.target.value);
                      if (t) set({ joins: (model.joins ?? []).map((x, j) => j === i ? { ...x, table: t.table, schema: t.schema, alias: x.alias || t.table.slice(0, 2) } : x) });
                    }}
                  >
                    <option value="">table…</option>
                    {allTables.filter((t) => t.connection === model.connection).map((t) => (
                      <option key={tableKey(t)} value={tableKey(t)}>{t.schema ? `${t.schema}.` : ''}{t.table}</option>
                    ))}
                  </select>
                  <Input
                    aria-label={`Join alias ${i + 1}`}
                    size="xs" fontFamily="mono" maxW="70px" placeholder="alias"
                    value={jn.alias} disabled={disabled}
                    onChange={(e) => set({ joins: (model.joins ?? []).map((x, j) => j === i ? { ...x, alias: e.target.value } : x) })}
                  />
                  <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">on</Text>
                  <select
                    aria-label={`Join left column ${i + 1}`}
                    style={{ ...selectStyle, maxWidth: '150px' }}
                    value={jn.leftColumn} disabled={disabled}
                    onChange={(e) => set({ joins: (model.joins ?? []).map((x, j) => j === i ? { ...x, leftColumn: e.target.value } : x) })}
                  >
                    <option value="">{model.table}…</option>
                    {baseColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                  <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">=</Text>
                  <select
                    aria-label={`Join right column ${i + 1}`}
                    style={{ ...selectStyle, maxWidth: '150px' }}
                    value={jn.rightColumn} disabled={disabled}
                    onChange={(e) => set({ joins: (model.joins ?? []).map((x, j) => j === i ? { ...x, rightColumn: e.target.value } : x) })}
                  >
                    <option value="">{jn.table || 'table'}…</option>
                    {(joinTableInfo?.columns ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                  {!disabled && (
                    <IconButton aria-label={`Remove join ${i + 1}`} size="2xs" variant="ghost" onClick={() => set({ joins: (model.joins ?? []).filter((_, j) => j !== i) })}>
                      <LuTrash2 size={12} />
                    </IconButton>
                  )}
                </HStack>
              );
            })}
            {!disabled && (
              <Button aria-label="Add join" size="2xs" variant="ghost" alignSelf="start"
                onClick={() => set({ joins: [...(model.joins ?? []), { table: '', alias: '', leftColumn: '', rightColumn: '' }] })}>
                <LuPlus size={12} /> join
              </Button>
            )}
          </VStack>
        </Row>

        {/* Ratio metrics */}
        <Row label="Metrics">
          <VStack align="stretch" gap={1} flex={1}>
            {(model.metrics ?? []).map((mt, i) => (
              <HStack key={i} gap={1.5}>
                <Input
                  aria-label={`Metric name ${i + 1}`}
                  size="xs" fontFamily="mono" maxW="160px" placeholder="Name"
                  value={mt.name} disabled={disabled}
                  onChange={(e) => set({ metrics: (model.metrics ?? []).map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}
                />
                <select
                  aria-label={`Metric numerator ${i + 1}`}
                  style={selectStyle}
                  value={mt.numerator} disabled={disabled}
                  onChange={(e) => set({ metrics: (model.metrics ?? []).map((x, j) => j === i ? { ...x, numerator: e.target.value } : x) })}
                >
                  <option value="">numerator…</option>
                  {model.measures.filter((m) => m.name).map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
                <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">/</Text>
                <select
                  aria-label={`Metric denominator ${i + 1}`}
                  style={selectStyle}
                  value={mt.denominator} disabled={disabled}
                  onChange={(e) => set({ metrics: (model.metrics ?? []).map((x, j) => j === i ? { ...x, denominator: e.target.value } : x) })}
                >
                  <option value="">denominator…</option>
                  {model.measures.filter((m) => m.name).map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
                {!disabled && (
                  <IconButton aria-label={`Remove metric ${i + 1}`} size="2xs" variant="ghost" onClick={() => set({ metrics: (model.metrics ?? []).filter((_, j) => j !== i) })}>
                    <LuTrash2 size={12} />
                  </IconButton>
                )}
              </HStack>
            ))}
            {!disabled && (
              <Button aria-label="Add ratio metric" size="2xs" variant="ghost" alignSelf="start"
                onClick={() => set({ metrics: [...(model.metrics ?? []), { name: '', type: 'ratio', numerator: '', denominator: '' }] })}>
                <LuPlus size={12} /> ratio metric
              </Button>
            )}
          </VStack>
        </Row>
      </VStack>
    </Box>
  );
}
