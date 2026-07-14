/**
 * SemanticQueryBuilder — the Semantic tier query editor.
 *
 * Users pick derived measures, dimensions, a time grain and filters from a
 * SemanticModel; the builder compiles the SemanticQuerySpec to QueryIR
 * (compileSemanticQuery) and to dialect SQL (irToSqlLocal) entirely
 * client-side, emitting both the spec (persisted as `content.semanticQuery`)
 * and the generated SQL (`content.query`).
 *
 * Models are derived on demand per table (never shipped in bulk): the model
 * picker lists cheap `stubs` (one per whitelisted table); picking one calls
 * `onSelectModel`, which makes the parent fetch that table's full model into
 * `models`. Until the fetch lands the builder shows a loading placeholder.
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Box, VStack, HStack, Text, Button, Input } from '@chakra-ui/react';
import { LuPlay, LuClock, LuSigma, LuGroup, LuFilter, LuDatabase, LuTriangleAlert } from 'react-icons/lu';
import { compileSemanticQuery, validateSemanticQuery } from '@/lib/semantic/compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import type { SemanticModel, SemanticTimeGrain } from '@/lib/types';
import type { ModelStub } from '@/lib/semantic/derive';
import type { SemanticQuerySpec, SemanticQueryFilter } from '@/lib/validation/atlas-schemas';
import { QueryChip, AddChipButton } from './QueryChip';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';

const TIME_GRAINS: SemanticTimeGrain[] = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];
const OPERATORS: SemanticQueryFilter['operator'][] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL'];

interface SemanticQueryBuilderProps {
  /** Full models loaded for the tables in play (fetched on demand). */
  models: SemanticModel[];
  /** One cheap stub per whitelisted table — the model picker's item list. */
  stubs: ModelStub[];
  /** Ask the parent to load the full model for a picked stub. */
  onSelectModel: (stub: ModelStub) => void;
  dialect: string;
  /** Persisted spec from content.semanticQuery, if any. */
  value: SemanticQuerySpec | null | undefined;
  /** Emits the edited spec plus the SQL compiled from it. */
  onChange: (spec: SemanticQuerySpec, sql: string) => void;
  onExecute?: () => void;
  isExecuting?: boolean;
}

const defaultSpec = (model: SemanticModel): SemanticQuerySpec => ({
  model: model.name,
  table: model.table,
  ...(model.schema ? { schema: model.schema } : {}),
  measures: model.measures.length > 0 ? [model.measures[0].name] : [],
  dimensions: [],
});

const specForStub = (stub: ModelStub): SemanticQuerySpec => ({
  model: stub.name,
  table: stub.table,
  ...(stub.schema ? { schema: stub.schema } : {}),
  measures: [],
  dimensions: [],
});

export function SemanticQueryBuilder({
  models,
  stubs,
  onSelectModel,
  dialect,
  value,
  onChange,
  onExecute,
  isExecuting = false,
}: SemanticQueryBuilderProps) {
  const [spec, setSpec] = useState<SemanticQuerySpec | null>(() => value ?? null);

  const model = spec ? models.find((m) => m.name === spec.model) : undefined;
  const issues = spec && model ? validateSemanticQuery(spec, model) : [];

  const apply = useCallback((next: SemanticQuerySpec, nextModel: SemanticModel) => {
    setSpec(next);
    if (validateSemanticQuery(next, nextModel).length > 0) return;
    try {
      const sql = irToSqlLocal(compileSemanticQuery(next, nextModel), dialect);
      onChange(next, sql);
    } catch (err) {
      console.error('[SemanticQueryBuilder] compile failed:', err);
    }
  }, [dialect, onChange]);

  const update = useCallback((updates: Partial<SemanticQuerySpec>) => {
    if (spec && model) apply({ ...spec, ...updates }, model);
  }, [apply, spec, model]);

  const handleModelChange = useCallback((name: string) => {
    const stub = stubs.find((st) => st.name === name);
    if (!stub || name === spec?.model) return;
    onSelectModel(stub); // parent fetches the full model
    const loaded = models.find((m) => m.name === name);
    if (loaded) {
      apply(defaultSpec(loaded), loaded);
    } else {
      setSpec(specForStub(stub)); // placeholder until the model lands
    }
  }, [apply, models, stubs, onSelectModel, spec?.model]);

  // A freshly picked (or detected/persisted) model finishing its fetch: give
  // the spec its default measure so the query is immediately runnable.
  useEffect(() => {
    if (!spec || spec.measures.length > 0) return;
    const loaded = models.find((m) => m.name === spec.model);
    if (loaded && loaded.measures.length > 0) {
      // Deferred so the compile+onChange happens outside the render pass.
      Promise.resolve().then(() => apply({ ...spec, measures: [loaded.measures[0].name] }, loaded));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, spec?.model, spec?.measures.length]);

  const measurables = model ? [
    ...model.measures.map((m) => ({ name: m.name, description: m.description, kind: 'measure' as const })),
    ...(model.metrics ?? []).map((m) => ({ name: m.name, description: m.description, kind: 'metric' as const })),
  ] : [];

  const modelPicker = (
    <ChipPicker
      ariaLabel="Semantic model"
      header="Semantic models"
      chipLabel={spec ? spec.model : undefined}
      chipVariant="table"
      items={stubs.map((st) => ({ name: st.name, selected: st.name === spec?.model }))}
      onSelect={handleModelChange}
    />
  );

  // Nothing picked yet (fresh question): just the model picker.
  if (!spec) {
    return (
      <Box>
        <VStack align="stretch" gap={3} p={4}>
          <SectionBox icon={<LuDatabase size={12} />} title="Model">
            {modelPicker}
            <Text fontSize="xs" color="fg.subtle" fontFamily="mono">Pick a table to start a semantic query.</Text>
          </SectionBox>
        </VStack>
      </Box>
    );
  }

  // Model picked but its vocabulary is still loading.
  if (!model) {
    return (
      <Box>
        <VStack align="stretch" gap={3} p={4}>
          <SectionBox icon={<LuDatabase size={12} />} title="Model">
            {modelPicker}
            <Text fontSize="xs" color="fg.subtle" fontFamily="mono">Loading {spec.model}…</Text>
          </SectionBox>
        </VStack>
      </Box>
    );
  }

  return (
    <Box>
      <VStack align="stretch" gap={3} p={4}>
        {/* Model */}
        <SectionBox icon={<LuDatabase size={12} />} title="Model">
          {modelPicker}
          {model.description && (
            <Text fontSize="xs" color="fg.subtle" fontFamily="mono">{model.description}</Text>
          )}
        </SectionBox>

        {/* Measures */}
        <SectionBox icon={<LuSigma size={12} />} title="Measures">
          {spec.measures.map((name) => (
            <QueryChip
              key={name}
              variant="metric"
              onRemove={spec.measures.length > 1
                ? () => update({ measures: spec.measures.filter((m) => m !== name) })
                : undefined}
            >
              {name}
            </QueryChip>
          ))}
          <ChipPicker
            ariaLabel="Add semantic measure"
            header="Measures & metrics"
            items={measurables
              .filter((m) => !spec.measures.includes(m.name))
              .map((m) => ({ name: m.name, description: m.description }))}
            onSelect={(name) => update({ measures: [...spec.measures, name] })}
          />
        </SectionBox>

        {/* Dimensions — named to match the model config's vocabulary */}
        <SectionBox icon={<LuGroup size={12} />} title="Dimensions">
          {spec.dimensions.map((name) => (
            <QueryChip key={name} variant="dimension" onRemove={() => update({ dimensions: spec.dimensions.filter((d) => d !== name) })}>
              {name}
            </QueryChip>
          ))}
          <ChipPicker
            ariaLabel="Add semantic dimension"
            header="Dimensions"
            items={model.dimensions
              .filter((d) => !spec.dimensions.includes(d.name))
              .map((d) => ({ name: d.name, description: d.description }))}
            onSelect={(name) => update({ dimensions: [...spec.dimensions, name] })}
          />
        </SectionBox>

        {/* Time grain (only when the model has a time dimension) */}
        {model.timeDimension && (
          <SectionBox icon={<LuClock size={12} />} title={model.timeDimension.label ?? 'Time'}>
            {spec.timeGrain ? (
              <ChipPicker
                ariaLabel="Edit time grain"
                header="Time grain"
                chipLabel={`per ${spec.timeGrain}`}
                chipVariant="dimension"
                onChipRemove={() => update({ timeGrain: undefined })}
                items={TIME_GRAINS.map((g) => ({ name: g, selected: g === spec.timeGrain }))}
                onSelect={(g) => update({ timeGrain: g as SemanticTimeGrain })}
              />
            ) : (
              <ChipPicker
                ariaLabel="Add time grain"
                header="Time grain"
                items={TIME_GRAINS.map((g) => ({ name: g }))}
                onSelect={(g) => update({ timeGrain: g as SemanticTimeGrain })}
              />
            )}
          </SectionBox>
        )}

        {/* Filters */}
        <SectionBox icon={<LuFilter size={12} />} title="Filter">
          {(spec.filters ?? []).map((f, idx) => (
            <QueryChip
              key={`${f.dimension}-${idx}`}
              variant="filter"
              onRemove={() => update({ filters: (spec.filters ?? []).filter((_, i) => i !== idx) })}
            >
              {f.operator === 'IS NULL' || f.operator === 'IS NOT NULL'
                ? `${f.dimension} ${f.operator}`
                : `${f.dimension} ${f.operator} ${Array.isArray(f.value) ? `(${f.value.join(', ')})` : String(f.value ?? '')}`}
            </QueryChip>
          ))}
          <SemanticFilterPicker
            dimensions={model.dimensions.map((d) => d.name)}
            onAdd={(filter) => update({ filters: [...(spec.filters ?? []), filter] })}
          />
        </SectionBox>

        {/* Limit + issues */}
        <HStack justify="space-between" align="center">
          <HStack gap={2}>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">Limit</Text>
            <Input
              aria-label="Semantic row limit"
              size="xs"
              width="90px"
              type="number"
              fontFamily="mono"
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
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function SectionBox({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Box bg="bg.subtle" borderRadius="lg" border="1px solid" borderColor="border.muted" p={3}>
      <HStack gap={1.5} mb={2.5}>
        <Box color="fg.muted">{icon}</Box>
        <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
          {title}
        </Text>
      </HStack>
      <HStack gap={2} flexWrap="wrap" align="center">
        {children}
      </HStack>
    </Box>
  );
}

/** Chip (or add button) that opens a named-item picker with descriptions. */
function ChipPicker({ ariaLabel, header, chipLabel, chipVariant = 'metric', onChipRemove, items, onSelect }: {
  ariaLabel: string;
  header: string;
  chipLabel?: string;
  chipVariant?: 'metric' | 'dimension' | 'table';
  onChipRemove?: () => void;
  items: Array<{ name: string; description?: string; selected?: boolean }>;
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      trigger={
        <Box aria-label={ariaLabel} cursor="pointer">
          {chipLabel ? (
            <QueryChip variant={chipVariant} onClick={() => setOpen(true)} onRemove={onChipRemove}>
              {chipLabel}
            </QueryChip>
          ) : (
            <AddChipButton onClick={() => setOpen(true)} variant={chipVariant} />
          )}
        </Box>
      }
    >
      <PickerHeader>{header}</PickerHeader>
      <PickerList maxH="260px" searchable searchPlaceholder="Search...">
        {(query) => items
          .filter((item) => !query || item.name.toLowerCase().includes(query.toLowerCase()))
          .map((item) => (
            <PickerItem
              key={item.name}
              aria-label={`${header}: ${item.name}`}
              selected={item.selected}
              onClick={() => { onSelect(item.name); setOpen(false); }}
            >
              <VStack align="start" gap={0} width="100%">
                <Text fontFamily="mono" fontSize="xs" fontWeight="600">{item.name}</Text>
                {item.description && (
                  <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">{item.description}</Text>
                )}
              </VStack>
            </PickerItem>
          ))}
      </PickerList>
    </PickerPopover>
  );
}

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
                value={value}
                placeholder={operator === 'IN' ? 'a, b, c' : 'value'}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                autoFocus
              />
            )}
            <HStack justify="flex-end" gap={2}>
              <Button aria-label="Cancel semantic filter" size="xs" variant="outline" onClick={close}>Cancel</Button>
              <Button
                aria-label="Apply semantic filter"
                size="xs"
                bg="accent.teal"
                color="white"
                onClick={submit}
                disabled={needsValue && !value.trim()}
              >
                Add
              </Button>
            </HStack>
          </>
        )}
      </VStack>
    </PickerPopover>
  );
}
