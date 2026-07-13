/**
 * SimpleQueryBuilder — the Simple tier (Scuba-style) query editor.
 *
 * One table, measures (aggregates), group-bys, an optional time dimension with
 * grain, flat AND filters, and a limit. Edits a `SimpleQuerySpec`
 * (lib/sql/simple-query.ts) and round-trips SQL through the shared IR:
 * SQL → sqlToIR → simpleSpecFromIr → (user edits) → irFromSimpleSpec → irToSql.
 *
 * The Simple tab is gated by `useGuiCompat().canUseSimple`, so this component
 * normally only sees SQL that fits; anything else renders the fallback notice.
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, VStack, HStack, Text, Button, Input, Spinner } from '@chakra-ui/react';
import { LuPlay, LuClock, LuSigma, LuGroup, LuFilter } from 'react-icons/lu';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import {
  simpleSpecFromIr, irFromSimpleSpec, pruneOrderBy,
  type SimpleQuerySpec, type SimpleMeasure, type SimpleFilterItem,
  type SimpleAggregate, type SimpleTimeGrain,
} from '@/lib/sql/simple-query';
import type { QueryIR, TableReference, FilterCondition } from '@/lib/sql/ir-types';
import { DataSection } from './DataSection';
import { QueryChip, AddChipButton } from './QueryChip';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
import type { QuestionOption } from '@/lib/hooks/useAvailableQuestions';

const AGGREGATES: Array<{ value: SimpleAggregate; label: string; needsColumn: boolean }> = [
  { value: 'COUNT', label: 'Count of rows', needsColumn: false },
  { value: 'COUNT_DISTINCT', label: 'Distinct values of…', needsColumn: true },
  { value: 'SUM', label: 'Sum of…', needsColumn: true },
  { value: 'AVG', label: 'Average of…', needsColumn: true },
  { value: 'MIN', label: 'Minimum of…', needsColumn: true },
  { value: 'MAX', label: 'Maximum of…', needsColumn: true },
];

const TIME_GRAINS: SimpleTimeGrain[] = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];

const OPERATORS: Array<FilterCondition['operator']> = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL'];

interface ColumnInfo { name: string; type?: string }

const isTemporal = (c: ColumnInfo) => /date|time|timestamp/i.test(c.type ?? '');
const isNumeric = (c: ColumnInfo) => /int|float|double|decimal|numeric|real|number/i.test(c.type ?? '');

/** Auto-alias for a measure added via the UI (deduped by the caller). */
const measureAlias = (agg: SimpleAggregate, column: string | null): string =>
  column ? `${agg.toLowerCase().replace('count_distinct', 'distinct')}_${column}`.slice(0, 60) : 'count';

const measureLabel = (m: SimpleMeasure): string =>
  m.aggregate === 'COUNT' && m.column == null ? 'COUNT(*)'
    : m.aggregate === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${m.column})`
    : `${m.aggregate}(${m.column})`;

const filterLabel = (f: SimpleFilterItem): string => {
  if (f.operator === 'IS NULL' || f.operator === 'IS NOT NULL') return `${f.column} ${f.operator}`;
  const v = Array.isArray(f.value) ? `(${f.value.join(', ')})` : String(f.value ?? '');
  return `${f.column} ${f.operator} ${v}`;
};

interface SimpleQueryBuilderProps {
  databaseName: string;
  dialect: string;
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute?: () => void;
  isExecuting?: boolean;
  availableQuestions?: QuestionOption[];
  whitelistedSchema?: Array<{ schema: string; tables: Array<{ table: string; columns: Array<{ name: string; type: string }> }> }>;
}

export function SimpleQueryBuilder({
  databaseName,
  dialect,
  sql,
  onSqlChange,
  onExecute,
  isExecuting = false,
  availableQuestions = [],
  whitelistedSchema,
}: SimpleQueryBuilderProps) {
  const [spec, setSpec] = useState<SimpleQuerySpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const lastSqlSent = useRef<string>('');

  // Dirty tracking: keep the user's original SQL verbatim until the spec changes.
  const [originalSql, setOriginalSql] = useState<string | null>(null);
  const [originalSpec, setOriginalSpec] = useState<SimpleQuerySpec | null>(null);

  // --- SQL → spec (on external SQL change) ----------------------------------
  useEffect(() => {
    let cancelled = false;
    async function loadSpec() {
      if (sql === lastSqlSent.current && spec !== null) {
        setLoading(false);
        return;
      }
      if (!sql.trim()) {
        setSpec({ table: { table: '' }, measures: [], groupBy: [], filters: [] });
        setLoading(false);
        lastSqlSent.current = sql;
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await CompletionsAPI.sqlToIR({ sql, dialect });
        if (cancelled) return;
        if (result.success && result.ir) {
          const fit = simpleSpecFromIr(result.ir as QueryIR);
          if (fit.fits) {
            setSpec(fit.spec);
            setOriginalSql(sql);
            setOriginalSpec(JSON.parse(JSON.stringify(fit.spec)));
            lastSqlSent.current = sql;
          } else {
            setError(`Not available in Simple mode: ${fit.reasons.join(', ')}`);
          }
        } else {
          setError(result.error || 'Failed to parse SQL');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadSpec();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, dialect]);

  // --- Load column info for the selected table ------------------------------
  useEffect(() => {
    let cancelled = false;
    const table = spec?.table.table;
    if (!table || !databaseName) {
      setColumns([]);
      return;
    }
    CompletionsAPI.getColumnSuggestions({ databaseName, table, schema: spec?.table.schema })
      .then((result) => {
        if (!cancelled && result.success && result.columns) setColumns(result.columns);
      })
      .catch(() => { /* picker just shows no columns */ });
    return () => { cancelled = true; };
  }, [databaseName, spec?.table.table, spec?.table.schema]);

  // --- spec → SQL (debounced) ------------------------------------------------
  useEffect(() => {
    if (!spec || !spec.table.table) return;
    const timeoutId = setTimeout(async () => {
      try {
        const dirty = originalSpec ? JSON.stringify(spec) !== JSON.stringify(originalSpec) : true;
        if (!dirty && originalSql) {
          if (originalSql !== lastSqlSent.current) {
            lastSqlSent.current = originalSql;
            onSqlChange(originalSql);
          }
          return;
        }
        const result = await CompletionsAPI.irToSql({ ir: irFromSimpleSpec(spec), dialect });
        if (result.success && result.sql && result.sql !== lastSqlSent.current) {
          lastSqlSent.current = result.sql;
          onSqlChange(result.sql);
        }
      } catch (err) {
        console.error('[SimpleQueryBuilder] Failed to generate SQL:', err);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [spec, dialect, onSqlChange, originalSpec, originalSql]);

  const updateSpec = useCallback((updater: (prev: SimpleQuerySpec) => SimpleQuerySpec) => {
    setSpec((prev) => (prev ? pruneOrderBy(updater(prev)) : prev));
  }, []);

  // --- Edit handlers ----------------------------------------------------------
  const handleTableChange = useCallback((table: TableReference) => {
    // Changing table resets column-dependent parts of the query.
    setSpec((prev) => ({
      table,
      measures: [],
      groupBy: [],
      filters: [],
      ...(prev?.limit !== undefined ? { limit: prev.limit } : {}),
    }));
  }, []);

  const addMeasure = useCallback((aggregate: SimpleAggregate, column: string | null) => {
    updateSpec((prev) => {
      const base = measureAlias(aggregate, column);
      const taken = new Set(prev.measures.map((m) => m.alias));
      let alias = base;
      for (let i = 2; taken.has(alias); i++) alias = `${base}_${i}`;
      return { ...prev, measures: [...prev.measures, { aggregate, column, alias }] };
    });
  }, [updateSpec]);

  const removeMeasure = useCallback((index: number) => {
    updateSpec((prev) => {
      const measures = prev.measures.filter((_, i) => i !== index);
      // Last measure removed → raw rows mode; dimensions/time make no sense.
      return measures.length === 0
        ? { ...prev, measures, groupBy: [], time: undefined }
        : { ...prev, measures };
    });
  }, [updateSpec]);

  const addGroupBy = useCallback((column: string) => {
    updateSpec((prev) => ({
      ...prev,
      groupBy: prev.groupBy.includes(column) ? prev.groupBy : [...prev.groupBy, column],
      // Grouping requires a measure — seed COUNT(*) like Scuba does.
      measures: prev.measures.length > 0 ? prev.measures : [{ aggregate: 'COUNT', column: null, alias: 'count' }],
    }));
  }, [updateSpec]);

  const removeGroupBy = useCallback((column: string) => {
    updateSpec((prev) => ({ ...prev, groupBy: prev.groupBy.filter((c) => c !== column) }));
  }, [updateSpec]);

  const setTime = useCallback((column: string, grain: SimpleTimeGrain) => {
    updateSpec((prev) => ({
      ...prev,
      time: { column, grain, alias: grain.toLowerCase() },
      measures: prev.measures.length > 0 ? prev.measures : [{ aggregate: 'COUNT', column: null, alias: 'count' }],
    }));
  }, [updateSpec]);

  const removeTime = useCallback(() => {
    updateSpec((prev) => {
      const { time: _time, ...rest } = prev;
      return rest;
    });
  }, [updateSpec]);

  const addFilter = useCallback((filter: SimpleFilterItem) => {
    updateSpec((prev) => ({ ...prev, filters: [...prev.filters, filter] }));
  }, [updateSpec]);

  const removeFilter = useCallback((index: number) => {
    updateSpec((prev) => ({ ...prev, filters: prev.filters.filter((_, i) => i !== index) }));
  }, [updateSpec]);

  const handleLimitChange = useCallback((value: string) => {
    const limit = parseInt(value, 10);
    updateSpec((prev) => {
      if (isNaN(limit) || limit <= 0) {
        const { limit: _limit, ...rest } = prev;
        return rest;
      }
      return { ...prev, limit };
    });
  }, [updateSpec]);

  // --- Render ------------------------------------------------------------------
  if (loading) {
    return (
      <Box p={4}>
        <HStack gap={3}>
          <Spinner size="sm" color="blue.400" />
          <Text fontSize="sm" color="fg.muted" fontFamily="mono">Loading simple builder...</Text>
        </HStack>
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={4}>
        <VStack align="start" gap={2}>
          <Text fontSize="sm" color="orange.400" fontFamily="mono">{error}</Text>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Switch to the GUI or SQL tab to edit this query.
          </Text>
        </VStack>
      </Box>
    );
  }

  if (!spec) return null;

  const temporalColumns = columns.filter(isTemporal);
  const groupableColumns = columns.filter((c) => !spec.groupBy.includes(c.name));

  return (
    <Box>
      <VStack align="stretch" gap={3} p={4}>
        <DataSection
          databaseName={databaseName}
          value={spec.table}
          onChange={handleTableChange}
          availableQuestions={availableQuestions}
          whitelistedSchema={whitelistedSchema}
        />

        {spec.table.table && (
          <>
            <SectionBox icon={<LuSigma size={12} />} title="Measure">
              {spec.measures.map((m, idx) => (
                <QueryChip
                  key={`${m.aggregate}-${m.column}-${idx}`}
                  variant="metric"
                  onRemove={() => removeMeasure(idx)}
                >
                  {measureLabel(m)}
                </QueryChip>
              ))}
              <MeasurePicker columns={columns} onAdd={addMeasure} />
              {spec.measures.length === 0 && (
                <Text fontSize="xs" color="fg.subtle" fontFamily="mono">showing raw rows</Text>
              )}
            </SectionBox>

            <SectionBox icon={<LuGroup size={12} />} title="Group by">
              {spec.groupBy.map((col) => (
                <QueryChip key={col} variant="dimension" onRemove={() => removeGroupBy(col)}>
                  {col}
                </QueryChip>
              ))}
              <ColumnPicker
                ariaLabel="Add group by"
                columns={groupableColumns}
                onSelect={addGroupBy}
              />
            </SectionBox>

            <SectionBox icon={<LuClock size={12} />} title="Time">
              {spec.time ? (
                <TimePicker
                  columns={temporalColumns.length > 0 ? temporalColumns : columns}
                  current={spec.time}
                  onSet={setTime}
                  onRemove={removeTime}
                />
              ) : (
                <TimePicker
                  columns={temporalColumns.length > 0 ? temporalColumns : columns}
                  onSet={setTime}
                />
              )}
            </SectionBox>

            <SectionBox icon={<LuFilter size={12} />} title="Filter">
              {spec.filters.map((f, idx) => (
                <QueryChip key={`${f.column}-${idx}`} variant="filter" onRemove={() => removeFilter(idx)}>
                  {filterLabel(f)}
                </QueryChip>
              ))}
              <FilterPicker columns={columns} onAdd={addFilter} />
            </SectionBox>

            <HStack justify="space-between" align="center">
              <HStack gap={2}>
                <Text fontSize="xs" color="fg.muted" fontFamily="mono">Limit</Text>
                <Input
                  aria-label="Row limit"
                  size="xs"
                  width="90px"
                  type="number"
                  fontFamily="mono"
                  value={spec.limit ?? ''}
                  placeholder="none"
                  onChange={(e) => handleLimitChange(e.target.value)}
                />
              </HStack>
            </HStack>

            {onExecute && (
              <Button
                aria-label="Execute simple query"
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
              >
                <LuPlay size={18} fill="white" />
                <Text ml={2} fontFamily="mono">Execute</Text>
              </Button>
            )}
          </>
        )}
      </VStack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Section + pickers
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

function ColumnPicker({ ariaLabel, columns, onSelect }: {
  ariaLabel: string;
  columns: ColumnInfo[];
  onSelect: (column: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      trigger={
        <Box aria-label={ariaLabel}>
          <AddChipButton onClick={() => setOpen(true)} variant="dimension" />
        </Box>
      }
    >
      <PickerHeader>Columns</PickerHeader>
      <PickerList maxH="260px" searchable searchPlaceholder="Search columns...">
        {(query) => columns
          .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))
          .map((c) => (
            <PickerItem key={c.name} aria-label={`${ariaLabel}: ${c.name}`} onClick={() => { onSelect(c.name); setOpen(false); }}>
              <HStack justify="space-between" width="100%">
                <Text fontFamily="mono" fontSize="xs">{c.name}</Text>
                <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">{c.type}</Text>
              </HStack>
            </PickerItem>
          ))}
      </PickerList>
    </PickerPopover>
  );
}

function MeasurePicker({ columns, onAdd }: {
  columns: ColumnInfo[];
  onAdd: (aggregate: SimpleAggregate, column: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingAgg, setPendingAgg] = useState<SimpleAggregate | null>(null);

  const close = () => { setOpen(false); setPendingAgg(null); };
  // SUM/AVG only make sense on numeric columns; others accept any column.
  const columnsFor = (agg: SimpleAggregate) => {
    if (agg === 'SUM' || agg === 'AVG') {
      const numeric = columns.filter(isNumeric);
      return numeric.length > 0 ? numeric : columns;
    }
    return columns;
  };

  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => { if (!details.open) close(); else setOpen(true); }}
      trigger={
        <Box aria-label="Add measure">
          <AddChipButton onClick={() => setOpen(true)} variant="metric" />
        </Box>
      }
    >
      {pendingAgg == null ? (
        <>
          <PickerHeader>Measure</PickerHeader>
          <PickerList maxH="260px">
            {() => AGGREGATES.map((agg) => (
              <PickerItem
                key={agg.value}
                aria-label={`Measure ${agg.value}`}
                onClick={() => {
                  if (agg.needsColumn) setPendingAgg(agg.value);
                  else { onAdd(agg.value, null); close(); }
                }}
              >
                {agg.label}
              </PickerItem>
            ))}
          </PickerList>
        </>
      ) : (
        <>
          <PickerHeader>{AGGREGATES.find((a) => a.value === pendingAgg)?.label}</PickerHeader>
          <PickerList maxH="260px" searchable searchPlaceholder="Search columns...">
            {(query) => columnsFor(pendingAgg)
              .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))
              .map((c) => (
                <PickerItem key={c.name} aria-label={`Measure column ${c.name}`} onClick={() => { onAdd(pendingAgg, c.name); close(); }}>
                  <HStack justify="space-between" width="100%">
                    <Text fontFamily="mono" fontSize="xs">{c.name}</Text>
                    <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">{c.type}</Text>
                  </HStack>
                </PickerItem>
              ))}
          </PickerList>
        </>
      )}
    </PickerPopover>
  );
}

function TimePicker({ columns, current, onSet, onRemove }: {
  columns: ColumnInfo[];
  current?: { column: string; grain: SimpleTimeGrain };
  onSet: (column: string, grain: SimpleTimeGrain) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingColumn, setPendingColumn] = useState<string | null>(null);
  const close = () => { setOpen(false); setPendingColumn(null); };

  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => { if (!details.open) close(); else setOpen(true); }}
      trigger={
        current ? (
          <Box aria-label="Edit time dimension" cursor="pointer">
            <QueryChip variant="dimension" onClick={() => setOpen(true)} onRemove={onRemove}>
              {`per ${current.grain} · ${current.column}`}
            </QueryChip>
          </Box>
        ) : (
          <Box aria-label="Add time dimension">
            <AddChipButton onClick={() => setOpen(true)} variant="dimension" />
          </Box>
        )
      }
    >
      {pendingColumn == null ? (
        <>
          <PickerHeader>Time column</PickerHeader>
          <PickerList maxH="260px" searchable searchPlaceholder="Search columns...">
            {(query) => columns
              .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))
              .map((c) => (
                <PickerItem key={c.name} aria-label={`Time column ${c.name}`} selected={current?.column === c.name} onClick={() => setPendingColumn(c.name)}>
                  <HStack justify="space-between" width="100%">
                    <Text fontFamily="mono" fontSize="xs">{c.name}</Text>
                    <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">{c.type}</Text>
                  </HStack>
                </PickerItem>
              ))}
          </PickerList>
        </>
      ) : (
        <>
          <PickerHeader>Grain</PickerHeader>
          <PickerList maxH="260px">
            {() => TIME_GRAINS.map((grain) => (
              <PickerItem
                key={grain}
                aria-label={`Time grain ${grain}`}
                selected={current?.grain === grain && current?.column === pendingColumn}
                onClick={() => { onSet(pendingColumn, grain); close(); }}
              >
                {grain.toLowerCase()}
              </PickerItem>
            ))}
          </PickerList>
        </>
      )}
    </PickerPopover>
  );
}

function FilterPicker({ columns, onAdd }: {
  columns: ColumnInfo[];
  onAdd: (filter: SimpleFilterItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [column, setColumn] = useState<string>('');
  const [operator, setOperator] = useState<FilterCondition['operator']>('=');
  const [value, setValue] = useState('');

  const reset = () => { setColumn(''); setOperator('='); setValue(''); };
  const close = () => { setOpen(false); reset(); };
  const needsValue = operator !== 'IS NULL' && operator !== 'IS NOT NULL';
  const colInfo = columns.find((c) => c.name === column);

  const submit = () => {
    if (!column || (needsValue && !value.trim())) return;
    let parsed: SimpleFilterItem['value'];
    if (needsValue) {
      if (operator === 'IN') {
        parsed = value.split(',').map((v) => v.trim()).filter(Boolean);
      } else if (colInfo && isNumeric(colInfo) && value.trim() !== '' && !isNaN(Number(value))) {
        parsed = Number(value);
      } else {
        parsed = value;
      }
    }
    onAdd({ column, operator, ...(needsValue ? { value: parsed } : {}) });
    close();
  };

  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => { if (!details.open) close(); else setOpen(true); }}
      trigger={
        <Box aria-label="Add filter">
          <AddChipButton onClick={() => setOpen(true)} variant="filter" />
        </Box>
      }
      width="300px"
      padding={3}
    >
      <VStack gap={2} align="stretch">
        {!column ? (
          <>
            <PickerHeader>Filter column</PickerHeader>
            <PickerList maxH="220px" searchable searchPlaceholder="Search columns...">
              {(query) => columns
                .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))
                .map((c) => (
                  <PickerItem key={c.name} aria-label={`Filter column ${c.name}`} onClick={() => setColumn(c.name)}>
                    <HStack justify="space-between" width="100%">
                      <Text fontFamily="mono" fontSize="xs">{c.name}</Text>
                      <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">{c.type}</Text>
                    </HStack>
                  </PickerItem>
                ))}
            </PickerList>
          </>
        ) : (
          <>
            <Text fontSize="xs" fontFamily="mono" fontWeight="600">{column}</Text>
            <HStack gap={1} flexWrap="wrap">
              {OPERATORS.map((op) => (
                <Button
                  key={op}
                  aria-label={`Operator ${op}`}
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
                aria-label="Filter value"
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
              <Button aria-label="Cancel filter" size="xs" variant="outline" onClick={close}>Cancel</Button>
              <Button
                aria-label="Apply filter"
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
