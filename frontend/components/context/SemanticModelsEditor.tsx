'use client';

/**
 * SemanticModelsSection — the per-connection semantic-model editor, rendered
 * inside the Databases tab ABOVE Data Models. The connection is implied by the
 * database section it lives in — a model here never picks a connection.
 *
 * LOOK & FEEL: the Data-Models row pattern. The section is its own bordered
 * container with an uppercase header bar; each model is a COMPACT ROW
 * (name · description · counts) whose full definition expands BELOW the row.
 * A row with attributed issues force-opens so save/test errors are never
 * hidden behind a collapsed row.
 *
 * ONE layout for both modes: read mode renders the same expanded body with
 * every definition as text (metric formulas, dimension mappings, join
 * equalities); edit mode swaps the text for inputs in place.
 *
 * PICKERS are SchemaOptionPicker popovers (mention-style rows, colored types,
 * search on long lists) — never native <select>s. Columns resolve through the
 * shared use-table-columns cache: the bounded (names-only) schema is only a
 * fast path, and on-demand fetches via /api/column-suggestions keep every
 * column picker populated at any schema size (same pattern as mention
 * drill-down and the whitelist tree).
 *
 * TEXT INPUTS ARE DRAFTS: they hold local state and commit on blur/Enter.
 * Committing per keystroke would push the whole (multi-MB) context content
 * through Redux + the dirty check on every character — the typing jank this
 * design explicitly retires.
 *
 * Join columns are INFERRED on source pick (lib/semantic/infer-join) and
 * always DISPLAYED as real `table.column = table.column` equalities — never as
 * "primary/bridge/referenced" jargon; the pair pickers only appear when
 * inference fails or the author expands them.
 *
 * Edits flow up as this connection's next `models` array; save-time tier-1/2/3
 * validation happens server-side in the context save gate and surfaces through
 * `issues` (attributed inline to the model / metric row each one names).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, VStack, HStack, Text, Input, Icon, Button, SimpleGrid } from '@chakra-ui/react';
import {
  LuPlus, LuTrash2, LuBoxes, LuTriangleAlert, LuPencil, LuKeyRound, LuFlaskConical,
  LuCircleCheck, LuChevronRight, LuChevronDown, LuTag, LuCalendarDays, LuSigma, LuLink2,
} from 'react-icons/lu';
import SchemaOptionPicker, { SchemaPickerOption } from '@/components/schema-browser/SchemaOptionPicker';
import { getTableColumns, type ColumnInfo } from '@/lib/hooks/use-table-columns';
import { exposedColumns } from '@/lib/types/views';
import { deriveSemanticModels, humanizeName } from '@/lib/semantic/derive';
import { validateSemanticModel } from '@/lib/semantic/validate';
import { fieldChecksTrustworthy } from '@/lib/semantic/edit-check';
import { testSemanticModel } from '@/lib/semantic/models-client';
import { inferToOneOn, inferM2MThrough, inferPrimaryKey, singularize } from '@/lib/semantic/infer-join';
import type {
  DatabaseWithSchema, ViewDef,
  SemanticModelV2, SemanticSource, SemanticReference, SemanticReferenceM2M, SemanticMetricV2,
  SemanticDimensionV2,
} from '@/lib/types';

interface SemanticModelsSectionProps {
  /** The connection this section belongs to — every model here lives on it. */
  connection: string;
  /** That connection's schema (source + column pickers; may be names-only). */
  database: DatabaseWithSchema | undefined;
  /** Views visible in this context (own + inherited); filtered by connection here. */
  views: ViewDef[];
  /** THIS CONNECTION's authored models (the parent owns the full array). */
  models: SemanticModelV2[];
  /** Inherited models on this connection (read-only rows). */
  inheritedModels?: SemanticModelV2[];
  editMode: boolean;
  onChange: (next: SemanticModelV2[]) => void;
  /** Save-gate issues (all of them — this section attributes its own). */
  issues?: string[];
  /** Path of the context file — the Test button validates against it. */
  contextPath?: string;
}

type Column = ColumnInfo;
type SourceOption = { value: string; label: string; columns: Column[]; isView?: boolean };

const AGGS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT'] as const;
const TEMPORAL_TYPE = /date|time/i;

// ---------------------------------------------------------------------------
// Source encoding — a SemanticSource as a stable picker value.
// ---------------------------------------------------------------------------

function encodeSource(s: SemanticSource | undefined): string {
  if (!s) return '';
  if (s.kind === 'model') return `v|${s.view}`;
  if (!s.table) return '';
  return `t|${s.schema ?? ''}|${s.table}`;
}

function decodeSource(value: string): SemanticSource | undefined {
  if (!value) return undefined;
  if (value.startsWith('v|')) return { kind: 'model', view: value.slice(2) };
  const [, schema, table] = value.split('|');
  return { kind: 'table', ...(schema ? { schema } : {}), table };
}

/** Tables + views of the connection, as source-picker options. */
function sourceOptionsFor(database: DatabaseWithSchema | undefined, connection: string, views: ViewDef[]): SourceOption[] {
  const tables: SourceOption[] = (database?.schemas ?? []).flatMap((s) =>
    s.tables.map((t) => ({
      value: `t|${s.schema}|${t.table}`,
      label: `${s.schema}.${t.table}`,
      columns: t.columns ?? [],
    })));
  const viewOpts: SourceOption[] = views
    .filter((v) => v.connection === connection)
    .map((v) => ({ value: `v|${v.name}`, label: `_views.${v.name}`, columns: exposedColumns(v), isView: true }));
  return [...tables, ...viewOpts];
}

const columnsOfSourceLocal = (source: SemanticSource | undefined, options: SourceOption[]): Column[] =>
  options.find((o) => o.value === encodeSource(source))?.columns ?? [];

/** How a source is spelled in a join equality: its table/view NAME. */
const sourceName = (s: SemanticSource | undefined): string =>
  !s ? '' : s.kind === 'table' ? s.table : s.view;

const isM2M = (r: SemanticReference): r is SemanticReferenceM2M => r.relationship === 'many_to_many';

const sourcePickerOptions = (options: SourceOption[]): SchemaPickerOption[] =>
  options.map((o) => ({ value: o.value, label: o.label, ...(o.isView ? { meta: 'view' } : {}) }));

const columnPickerOptions = (columns: Column[]): SchemaPickerOption[] =>
  columns.map((c) => ({ value: c.name, label: c.name, meta: c.type }));

// ---------------------------------------------------------------------------
// Auto-naming — a picked column proposes a business name; the proposal stays
// "auto" (following later column changes) until the author types their own,
// which is then never clobbered. Same rule as reference-alias auto-fill.
// ---------------------------------------------------------------------------

/** `current` if hand-typed; `nextAuto` if empty or still the previous auto. */
const followAutoName = (current: string, prevAuto: string, nextAuto: string): string =>
  current === '' || current === prevAuto ? nextAuto : current;

const AGG_NAME_PREFIX: Record<string, string> = {
  SUM: 'Total', AVG: 'Avg', COUNT_DISTINCT: 'Unique', MIN: 'Min', MAX: 'Max', COUNT: 'Count of',
};

const aggAutoName = (agg: string, column: string): string =>
  column ? `${AGG_NAME_PREFIX[agg] ?? ''} ${humanizeName(column)}`.trim() : '';

// ---------------------------------------------------------------------------
// Save-gate issues — recovering the LIST, then attributing each issue to a row.
//
// The gate (lib/semantic/save-gate.server.ts) throws a SemanticModelSaveError
// carrying `issues: string[]`; the HTTP boundary can only carry a message, so
// the issues cross it newline-joined and are recovered here. The split is
// ANCHORED on the `Semantic model "` prefix every issue starts with, because a
// single issue can itself be multi-line (tier-3 engine errors quote the SQL) —
// a bare \n split would shred one error into several nonsense ones.
// ---------------------------------------------------------------------------

const ISSUE_PREFIX = 'Semantic model "';
/** `Semantic model "<name>": <detail>` — detail may span lines. */
const MODEL_ISSUE = /^Semantic model "([^"]+)":\s*([\s\S]*)$/;
/** Metric problems lead with the metric name (`does not compile` / `failed engine validation`). */
const METRIC_NAME = /metric "([^"]+)"/;

/**
 * Recover the issue list from a save-error message. Returns `[]` for anything
 * that is not a semantic-gate message (view-gate errors, generic failures) —
 * those stay banner-only rather than being mis-attributed to a model row.
 */
export function parseSemanticModelIssues(message: string | null | undefined): string[] {
  if (!message || !message.startsWith(ISSUE_PREFIX)) return [];
  return message.split(new RegExp(`\\n(?=${ISSUE_PREFIX})`)).map((s) => s.trim()).filter(Boolean);
}

interface AttributedIssues {
  byModel: Map<number, string[]>;
  byMetric: Map<string, string[]>; // `${modelIndex}:${metricIndex}`
  unattributed: string[];
}

function attributeIssues(issues: string[], models: SemanticModelV2[]): AttributedIssues {
  const attributed: AttributedIssues = { byModel: new Map(), byMetric: new Map(), unattributed: [] };
  const push = <K,>(map: Map<K, string[]>, key: K, text: string) => {
    const list = map.get(key);
    if (list) list.push(text); else map.set(key, [text]);
  };
  for (const issue of issues) {
    const match = MODEL_ISSUE.exec(issue);
    const modelIndex = match ? models.findIndex((m) => m.name === match[1]) : -1;
    if (!match || modelIndex < 0) { attributed.unattributed.push(issue); continue; }
    const detail = match[2];
    const metricName = METRIC_NAME.exec(detail)?.[1];
    const metricIndex = metricName
      ? models[modelIndex].metrics.findIndex((mt) => mt.name === metricName)
      : -1;
    if (metricIndex >= 0) push(attributed.byMetric, `${modelIndex}:${metricIndex}`, detail);
    else push(attributed.byModel, modelIndex, detail);
  }
  return attributed;
}

// ---------------------------------------------------------------------------
// Draft inputs — local state, committed on blur/Enter. NEVER per keystroke:
// each commit pushes the whole context content through Redux + dirty check.
// External updates (auto-naming after a column pick) sync in while unfocused.
// ---------------------------------------------------------------------------

interface DraftProps {
  'aria-label': string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
}

/**
 * The draft state machine: hold keystrokes locally, sync in external changes
 * (auto-naming after a column pick) only while unfocused — via the
 * adjust-state-during-render pattern, not an effect — and commit on blur.
 */
function useDraft(value: string, onCommit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const [focused, setFocused] = useState(false);
  if (value !== synced) {
    setSynced(value);
    if (!focused) setDraft(value);
  }
  return {
    draft,
    setDraft,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (draft !== value) onCommit(draft);
    },
  };
}

function DraftInput({ 'aria-label': label, value, onCommit, placeholder, ...rest }:
  DraftProps & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur'>) {
  const { draft, setDraft, onFocus, onBlur } = useDraft(value, onCommit);
  return (
    <Input
      aria-label={label} size="2xs" value={draft} placeholder={placeholder}
      onFocus={onFocus}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      {...rest}
    />
  );
}

function DraftTextarea({ 'aria-label': label, value, onCommit, placeholder, rows = 2 }:
  DraftProps & { rows?: number }) {
  const { draft, setDraft, onFocus, onBlur } = useDraft(value, onCommit);
  return (
    <textarea
      aria-label={label} rows={rows}
      style={{
        fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: '12px',
        border: '1px solid var(--chakra-colors-border-muted)', borderRadius: '6px',
        background: 'var(--chakra-colors-bg-canvas)', color: 'var(--chakra-colors-fg-default)',
        padding: '6px 8px', outline: 'none', resize: 'vertical', width: '100%',
      }}
      value={draft} placeholder={placeholder}
      onFocus={onFocus}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={onBlur}
    />
  );
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/**
 * Group bar — the SemanticExplorer field-panel header: icon + uppercase title
 * on the left, count + (edit mode) a compact + button on the right.
 */
function GroupBar({ icon, label, count, onAdd, addLabel }: {
  icon: React.ElementType; label: string; count: number; onAdd?: () => void; addLabel?: string;
}) {
  return (
    <HStack gap={1.5} align="center" px={2} py={1}
      bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted">
      <Icon as={icon} boxSize={3} color="fg.subtle" />
      <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.04em">
        {label}
      </Text>
      <Box flex={1} />
      {count > 0 && <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">{count}</Text>}
      {onAdd && (
        <Box as="button" aria-label={addLabel} onClick={onAdd} color="fg.subtle" cursor="pointer"
          borderRadius="sm" px={0.5} _hover={{ color: 'accent.teal', bg: 'bg.muted' }} lineHeight={1}>
          <Icon as={LuPlus} boxSize={3} />
        </Box>
      )}
    </HStack>
  );
}

/** A bordered field panel (rows under a GroupBar), explorer-style. */
function FieldPanel({ children, ...rest }: React.ComponentProps<typeof Box>) {
  return (
    <Box border="1px solid" borderColor="border.muted" borderRadius="md" overflow="hidden"
      bg="bg.surface" alignSelf="start" w="100%" {...rest}>
      {children}
    </Box>
  );
}

function DeleteRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Box as="button" aria-label={label}
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); onClick(); }}
      color="fg.subtle" cursor="pointer"
      _hover={{ color: 'accent.danger' }} flexShrink={0} lineHeight={1}>
      <Icon as={LuTrash2} boxSize={3.5} />
    </Box>
  );
}

function UnverifiedBadge({ label }: { label: string }) {
  return (
    <HStack aria-label={label} gap={1} px={1.5} py={0.5} bg="accent.warning/10" borderRadius="sm" flexShrink={0}
      title="unverified — warehouse unreachable at last save; re-checked on next save">
      <Icon as={LuTriangleAlert} boxSize={3} color="accent.warning" />
      <Text fontSize="10px" fontWeight="600" color="accent.warning" fontFamily="mono">unverified</Text>
    </HStack>
  );
}

/** Save-gate issues for one row (model / metric) or the unattributed fallback. */
function IssueList({ label, issues }: { label: string; issues: string[] }) {
  return (
    <VStack aria-label={label} align="stretch" gap={1} px={2} py={1.5}
      bg="accent.danger/8" border="1px solid" borderColor="accent.danger/20" borderRadius="md">
      {issues.map((text, i) => (
        <HStack key={i} gap={1.5} align="start">
          {/* The icon centers on the FIRST text line (18px = xs line height),
              so single-line issues read balanced and multi-line ones anchor top. */}
          <Box h="18px" display="flex" alignItems="center" flexShrink={0}>
            <Icon as={LuTriangleAlert} boxSize={3} color="accent.danger" />
          </Box>
          <Text fontSize="xs" lineHeight="18px" fontFamily="mono" color="accent.danger" whiteSpace="pre-wrap">{text}</Text>
        </HStack>
      ))}
    </VStack>
  );
}

/** Read-mode definition text (also used for the always-text join lines). */
function DefText({ label, children, muted = true }: { label?: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <Text {...(label ? { 'aria-label': label } : {})} fontSize="xs" fontFamily="mono"
      color={muted ? 'fg.muted' : 'fg.default'} lineClamp={2}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Definition text builders (read mode + join lines)
// ---------------------------------------------------------------------------

const metricDefText = (mt: SemanticMetricV2): string => {
  if (mt.type === 'aggregation') return `${mt.agg}(${mt.column ?? '*'})`;
  if (mt.type === 'ratio') return `${mt.numerator} ÷ ${mt.denominator}`;
  return mt.sql;
};

const dimensionDefText = (d: SemanticDimensionV2): string =>
  d.source === 'primary' ? d.column : `${d.source}.${d.column}`;

const relationshipText: Record<SemanticReference['relationship'], string> = {
  many_to_one: 'many-to-one',
  one_to_one: 'one-to-one',
  many_to_many: 'many-to-many',
};

/** The join line: real `table.column = table.column` equalities. */
function joinText(model: SemanticModelV2, ref: SemanticReference): string {
  const base = sourceName(model.primary);
  const far = sourceName(ref.source);
  if (!isM2M(ref)) {
    return ref.on
      .filter((p) => p.primaryColumn && p.referencedColumn)
      .map((p) => `${base}.${p.primaryColumn} = ${far}.${p.referencedColumn}`)
      .join(' AND ');
  }
  const via = sourceName(ref.through.source);
  const near = ref.through.primaryOn
    .filter((p) => p.primaryColumn && p.bridgeColumn)
    .map((p) => `${base}.${p.primaryColumn} = ${via}.${p.bridgeColumn}`);
  const farSide = ref.through.referencedOn
    .filter((p) => p.bridgeColumn && p.referencedColumn)
    .map((p) => `${via}.${p.bridgeColumn} = ${far}.${p.referencedColumn}`);
  return [...near, ...farSide].join(' · ');
}

const refComplete = (ref: SemanticReference): boolean =>
  isM2M(ref)
    ? !!sourceName(ref.through.source)
      && ref.through.primaryOn.every((p) => p.primaryColumn && p.bridgeColumn)
      && ref.through.referencedOn.every((p) => p.bridgeColumn && p.referencedColumn)
    : ref.on.every((p) => p.primaryColumn && p.referencedColumn);

// ---------------------------------------------------------------------------
// On-demand columns for every source a model touches. The bounded schema's
// columns are the fast path; names-only tables fetch through the SHARED
// use-table-columns session cache (one request per table, ever). `enabled`
// gates fetching to open, editable rows so collapsed models cost nothing.
// ---------------------------------------------------------------------------

function useModelColumns(
  m: SemanticModelV2,
  options: SourceOption[],
  connection: string,
  enabled: boolean,
): (source: SemanticSource | undefined) => Column[] {
  const refs = m.references ?? [];
  const sources = useMemo(
    () => [m.primary, ...refs.flatMap((r) => (isM2M(r) ? [r.source, r.through.source] : [r.source]))],
    [m.primary, refs],
  );
  const [remote, setRemote] = useState<Record<string, Column[]>>({});
  const encodedKey = sources.map(encodeSource).join(',');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    for (const s of sources) {
      if (!s || s.kind !== 'table' || !s.table) continue;
      const key = encodeSource(s);
      if (columnsOfSourceLocal(s, options).length > 0 || remote[key]) continue;
      getTableColumns({ name: s.table, schema: s.schema ?? undefined, connection }).then((columns) => {
        if (!cancelled && columns.length > 0) {
          setRemote((prev) => (prev[key] ? prev : { ...prev, [key]: columns }));
        }
      });
    }
    return () => { cancelled = true; };
  }, [encodedKey, enabled, options]); // eslint-disable-line react-hooks/exhaustive-deps

  return (source) => {
    const local = columnsOfSourceLocal(source, options);
    if (local.length > 0) return local;
    return remote[encodeSource(source)] ?? [];
  };
}

/** Event-time resolution (inference on pick) — same cache, no hook needed. */
async function resolveColumns(
  source: SemanticSource | undefined,
  options: SourceOption[],
  connection: string,
): Promise<Column[]> {
  const local = columnsOfSourceLocal(source, options);
  if (local.length > 0 || !source || source.kind !== 'table' || !source.table) return local;
  return getTableColumns({ name: source.table, schema: source.schema ?? undefined, connection });
}

// ---------------------------------------------------------------------------
// One model: compact row + expandable definition body
// ---------------------------------------------------------------------------

interface ModelCardProps {
  m: SemanticModelV2;
  i: number;
  inherited: boolean;
  open: boolean;
  onToggle: () => void;
  editMode: boolean;
  connection: string;
  options: SourceOption[];
  modelIssues: string[];
  metricIssues: (j: number) => string[];
  testStatus?: 'running' | 'ok';
  onTest?: () => void;
  canTest: boolean;
  patchModel: (changes: Partial<SemanticModelV2>) => void;
  commitName: (name: string) => void;
  onDelete: () => void;
  onPrimaryPicked: (value: string) => void;
  openJoins: Set<string>;
  toggleJoinOpen: (j: number) => void;
}

function ModelCard({
  m, i, inherited, open, onToggle, editMode, connection, options,
  modelIssues, metricIssues, testStatus, onTest, canTest,
  patchModel, commitName, onDelete, onPrimaryPicked, openJoins, toggleJoinOpen,
}: ModelCardProps) {
  const canEdit = editMode && !inherited;
  const columnsOf = useModelColumns(m, options, connection, canEdit && open);
  const primaryColumns = columnsOf(m.primary);
  const refs = m.references ?? [];
  const hasM2M = refs.some(isM2M);
  const aggMetricNames = m.metrics.filter((mt) => mt.type === 'aggregation').map((mt) => mt.name);
  const temporalColumns = primaryColumns.filter((c) => TEMPORAL_TYPE.test(c.type));
  const timeDims = m.dimensions.map((d, j) => ({ d, j })).filter(({ d }) => d.temporal);
  const plainDims = m.dimensions.map((d, j) => ({ d, j })).filter(({ d }) => !d.temporal);
  const primaryLabel = options.find((o) => o.value === encodeSource(m.primary))?.label ?? sourceName(m.primary);

  const patchRef = (j: number, next: SemanticReference) =>
    patchModel({ references: refs.map((r, k) => (k === j ? next : r)) });
  const patchMetric = (j: number, next: SemanticMetricV2) =>
    patchModel({ metrics: m.metrics.map((mt, k) => (k === j ? next : mt)) });
  const patchDim = (j: number, next: SemanticDimensionV2) =>
    patchModel({ dimensions: m.dimensions.map((d, k) => (k === j ? next : d)) });

  /** Source pick on a reference: infer alias + join columns in one shot. */
  const pickRefSource = async (j: number, value: string) => {
    const r = refs[j];
    const source = decodeSource(value) ?? { kind: 'table' as const, table: '' };
    const autoAlias = r.alias === '' || r.alias === singularize(sourceName(r.source));
    const alias = autoAlias && sourceName(source) ? singularize(sourceName(source)) : r.alias;
    if (isM2M(r)) {
      patchRef(j, { ...r, source, alias });
      return;
    }
    const [primaryCols, refCols] = await Promise.all([
      resolveColumns(m.primary, options, connection),
      resolveColumns(source, options, connection),
    ]);
    const inferred = inferToOneOn(primaryCols, refCols, sourceName(source));
    patchRef(j, { ...r, source, alias, on: inferred ?? [{ primaryColumn: '', referencedColumn: '' }] });
  };

  /** Via (bridge) pick on an m2m reference: infer the whole through + grain. */
  const pickViaSource = async (j: number, value: string) => {
    const r = refs[j];
    if (!isM2M(r)) return;
    const via = decodeSource(value) ?? { kind: 'table' as const, table: '' };
    const [primaryCols, bridgeCols, refCols] = await Promise.all([
      resolveColumns(m.primary, options, connection),
      resolveColumns(via, options, connection),
      resolveColumns(r.source, options, connection),
    ]);
    const inferred = inferM2MThrough({
      primaryKey: m.primaryKey ?? [],
      primaryColumns: primaryCols,
      bridgeColumns: bridgeCols,
      refColumns: refCols,
      primaryTable: sourceName(m.primary),
      refTable: sourceName(r.source),
    });
    const nextRef: SemanticReferenceM2M = {
      ...r,
      through: inferred
        ? { source: via, ...inferred }
        : { source: via, primaryOn: [{ primaryColumn: '', bridgeColumn: '' }], referencedOn: [{ bridgeColumn: '', referencedColumn: '' }] },
    };
    const grain = m.primaryKey?.length
      ? undefined
      : inferred
        ? inferred.primaryOn.map((p) => p.primaryColumn)
        : inferPrimaryKey(primaryCols, sourceName(m.primary)) ?? undefined;
    patchModel({
      references: refs.map((x, k) => (k === j ? nextRef : x)),
      ...(grain ? { primaryKey: grain } : {}),
    });
  };

  const pickRelationship = async (j: number, rel: SemanticReference['relationship']) => {
    const r = refs[j];
    if (rel === r.relationship) return;
    if (rel === 'many_to_many') {
      patchRef(j, {
        source: r.source, alias: r.alias, relationship: 'many_to_many',
        through: {
          source: { kind: 'table', table: '' },
          primaryOn: [{ primaryColumn: '', bridgeColumn: '' }],
          referencedOn: [{ bridgeColumn: '', referencedColumn: '' }],
        },
      });
      return;
    }
    const [primaryCols, refCols] = await Promise.all([
      resolveColumns(m.primary, options, connection),
      resolveColumns(r.source, options, connection),
    ]);
    const on = !isM2M(r) && r.on.length > 0 ? r.on
      : inferToOneOn(primaryCols, refCols, sourceName(r.source)) ?? [{ primaryColumn: '', referencedColumn: '' }];
    patchRef(j, { source: r.source, alias: r.alias, relationship: rel, on });
  };

  const renameAlias = (j: number, next: string) => {
    const r = refs[j];
    // Cascade: dimensions carry the alias in `source` — a rename without
    // this leaves them dangling and the save gate rejects the whole model.
    patchModel({
      references: refs.map((x, k) => (k === j ? { ...x, alias: next } : x)),
      dimensions: m.dimensions.map((d) => (d.source === r.alias ? { ...d, source: next } : d)),
    });
  };

  const columnPicker = (
    label: string, columns: Column[], value: string, onPick: (v: string) => void,
    over: Partial<React.ComponentProps<typeof SchemaOptionPicker>> = {},
  ) => (
    <SchemaOptionPicker label={label} value={value} options={columnPickerOptions(columns)}
      onSelect={onPick} placeholder="column…"
      emptyMessage="no columns found — pick a source table first" {...over} />
  );

  // ── rows ────────────────────────────────────────────────────────────────

  const referenceRow = (r: SemanticReference, j: number) => {
    const refColumns = columnsOf(r.source);
    const viaColumns = isM2M(r) ? columnsOf(r.through.source) : [];
    const showPairs = canEdit && (openJoins.has(`${m.name}:${j}`) || !refComplete(r));
    const base = sourceName(m.primary);
    const far = sourceName(r.source);
    const via = isM2M(r) ? sourceName(r.through.source) : '';
    return (
      <VStack key={j} align="stretch" gap={1} px={2} py={1.5}
        borderBottom="1px solid" borderColor="border.muted" _last={{ borderBottom: 'none' }}>
        <HStack gap={2} flexWrap="wrap" align="center">
          {canEdit ? (
            <>
              <DraftInput aria-label={`semantic-model-${i}-reference-${j}-alias`} fontFamily="mono" maxW="110px"
                value={r.alias} placeholder="alias" onCommit={(v) => renameAlias(j, v)} />
              <Text fontSize="xs" color="fg.subtle">·</Text>
              <SchemaOptionPicker label={`semantic-model-${i}-reference-${j}-source`}
                value={encodeSource(r.source)} options={sourcePickerOptions(options)}
                onSelect={(v) => pickRefSource(j, v)} placeholder="pick table…" minW="160px" />
              <SchemaOptionPicker label={`semantic-model-${i}-reference-${j}-relationship`}
                value={r.relationship}
                options={(Object.keys(relationshipText) as SemanticReference['relationship'][])
                  .map((rel) => ({ value: rel, label: relationshipText[rel] }))}
                onSelect={(v) => pickRelationship(j, v as SemanticReference['relationship'])} />
              {isM2M(r) && (
                <>
                  <Text fontSize="xs" color="fg.muted" flexShrink={0}>via</Text>
                  <SchemaOptionPicker label={`semantic-model-${i}-reference-${j}-via-source`}
                    value={encodeSource(r.through.source)} options={sourcePickerOptions(options)}
                    onSelect={(v) => pickViaSource(j, v)} placeholder="pick table…" minW="160px" />
                </>
              )}
              <Box flex={1} />
              {refComplete(r) && (
                <Box as="button" aria-label={`semantic-model-${i}-reference-${j}-adjust-join`}
                  onClick={() => toggleJoinOpen(j)} color="fg.subtle" cursor="pointer"
                  _hover={{ color: 'accent.teal' }} lineHeight={1} title="Adjust join columns">
                  <Icon as={LuPencil} boxSize={3} />
                </Box>
              )}
              <DeleteRowButton label={`semantic-model-${i}-reference-${j}-delete`}
                onClick={() => patchModel({ references: refs.filter((_, k) => k !== j) })} />
            </>
          ) : (
            <DefText muted={false}>
              <Text as="span" fontWeight="600">{r.alias}</Text>
              <Text as="span" color="fg.muted"> · {far || '—'} — {relationshipText[r.relationship]}{isM2M(r) && via ? ` via ${via}` : ''}</Text>
            </DefText>
          )}
        </HStack>
        {/* The join, ALWAYS as real column equalities. */}
        <DefText label={`semantic-model-${i}-reference-${j}-join`}>
          {joinText(m, r) || 'join columns not set'}
        </DefText>
        {showPairs && !isM2M(r) && (
          <VStack align="stretch" gap={1}>
            {r.on.map((pair, k) => (
              <HStack key={k} gap={1.5} flexWrap="wrap">
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{base}.</Text>
                {columnPicker(`semantic-model-${i}-reference-${j}-on-${k}-primary-column`,
                  primaryColumns, pair.primaryColumn,
                  (v) => patchRef(j, { ...r, on: r.on.map((p, x) => (x === k ? { ...p, primaryColumn: v } : p)) }))}
                <Text fontSize="xs" color="fg.subtle">=</Text>
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{far}.</Text>
                {columnPicker(`semantic-model-${i}-reference-${j}-on-${k}-referenced-column`,
                  refColumns, pair.referencedColumn,
                  (v) => patchRef(j, { ...r, on: r.on.map((p, x) => (x === k ? { ...p, referencedColumn: v } : p)) }))}
                {r.on.length > 1 && (
                  <DeleteRowButton label={`semantic-model-${i}-reference-${j}-on-${k}-delete`}
                    onClick={() => patchRef(j, { ...r, on: r.on.filter((_, x) => x !== k) })} />
                )}
              </HStack>
            ))}
            <Box>
              <Box as="button" aria-label={`semantic-model-${i}-reference-${j}-add-on-pair`}
                onClick={() => patchRef(j, { ...r, on: [...r.on, { primaryColumn: '', referencedColumn: '' }] })}
                color="fg.subtle" cursor="pointer" _hover={{ color: 'accent.teal' }} fontSize="11px" fontFamily="mono">
                + join column pair
              </Box>
            </Box>
          </VStack>
        )}
        {showPairs && isM2M(r) && (() => {
          const primaryOn = r.through.primaryOn[0] ?? { primaryColumn: '', bridgeColumn: '' };
          const referencedOn = r.through.referencedOn[0] ?? { bridgeColumn: '', referencedColumn: '' };
          return (
            <VStack align="stretch" gap={1}>
              <HStack gap={1.5} flexWrap="wrap">
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{base}.</Text>
                {columnPicker(`semantic-model-${i}-reference-${j}-primary-on-primary-column`,
                  primaryColumns, primaryOn.primaryColumn,
                  (v) => patchRef(j, { ...r, through: { ...r.through, primaryOn: [{ ...primaryOn, primaryColumn: v }] } }))}
                <Text fontSize="xs" color="fg.subtle">=</Text>
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{via || 'via'}.</Text>
                {columnPicker(`semantic-model-${i}-reference-${j}-primary-on-bridge-column`,
                  viaColumns, primaryOn.bridgeColumn,
                  (v) => patchRef(j, { ...r, through: { ...r.through, primaryOn: [{ ...primaryOn, bridgeColumn: v }] } }))}
              </HStack>
              <HStack gap={1.5} flexWrap="wrap">
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{via || 'via'}.</Text>
                {columnPicker(`semantic-model-${i}-reference-${j}-referenced-on-bridge-column`,
                  viaColumns, referencedOn.bridgeColumn,
                  (v) => patchRef(j, { ...r, through: { ...r.through, referencedOn: [{ ...referencedOn, bridgeColumn: v }] } }))}
                <Text fontSize="xs" color="fg.subtle">=</Text>
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{far}.</Text>
                {columnPicker(`semantic-model-${i}-reference-${j}-referenced-on-referenced-column`,
                  refColumns, referencedOn.referencedColumn,
                  (v) => patchRef(j, { ...r, through: { ...r.through, referencedOn: [{ ...referencedOn, referencedColumn: v }] } }))}
              </HStack>
            </VStack>
          );
        })()}
      </VStack>
    );
  };

  /** Explorer-style read row: icon + business name left, definition right. */
  const readFieldRow = (label: string, icon: React.ElementType, name: string, def: string, extra?: React.ReactNode) => (
    <HStack aria-label={label} px={2} py={1} gap={2} justify="space-between"
      borderBottom="1px solid" borderColor="border.muted" _last={{ borderBottom: 'none' }}
      _hover={{ bg: 'bg.muted' }} transition="background 0.1s">
      <HStack gap={1.5} minW={0}>
        <Icon as={icon} boxSize={3} color="fg.muted" flexShrink={0} />
        <Text fontSize="xs" fontWeight="600" truncate>{name}</Text>
        {extra}
      </HStack>
      <Text fontSize="xs" fontFamily="mono" color="fg.muted" truncate flexShrink={1} maxW="60%" title={def}>
        {def}
      </Text>
    </HStack>
  );

  const editRowProps = {
    px: 2, py: 1, gap: 2, align: 'center' as const,
    borderBottom: '1px solid', borderColor: 'border.muted', _last: { borderBottom: 'none' },
  };

  // Dimension rows read SOURCE-FIRST (`column → name`): the column is the
  // input, the business name is what it becomes.
  const timeDimRow = ({ d, j }: { d: SemanticDimensionV2; j: number }) =>
    canEdit ? (
      <HStack key={j} {...editRowProps}>
        {columnPicker(`semantic-model-${i}-dimension-${j}-column`,
          temporalColumns.length > 0 ? temporalColumns : primaryColumns, d.column,
          (v) => patchDim(j, {
            ...d, column: v,
            name: followAutoName(d.name, humanizeName(d.column), humanizeName(v)),
          }))}
        <Text fontSize="xs" color="fg.subtle">→</Text>
        <DraftInput aria-label={`semantic-model-${i}-dimension-${j}-name`} maxW="180px"
          value={d.name} placeholder="name" onCommit={(v) => patchDim(j, { ...d, name: v })} />
        <Box flex={1} />
        <DeleteRowButton label={`semantic-model-${i}-dimension-${j}-delete`}
          onClick={() => patchModel({ dimensions: m.dimensions.filter((_, k) => k !== j) })} />
      </HStack>
    ) : (
      <React.Fragment key={j}>
        {readFieldRow(`semantic-model-${i}-dimension-${j}-definition`, LuCalendarDays, d.name, dimensionDefText(d))}
      </React.Fragment>
    );

  // Combined source+column pick for a plain dimension: one picker, values
  // `primary|<col>` and `<alias>|<col>` — two dropdowns collapsed into one.
  const fieldValue = (d: SemanticDimensionV2) => (d.column ? `${d.source}|${d.column}` : '');
  const fieldOptions = (): SchemaPickerOption[] => [
    ...primaryColumns.map((c) => ({ value: `primary|${c.name}`, label: c.name, meta: c.type })),
    ...refs.filter((r) => r.alias).flatMap((r) =>
      columnsOf(r.source).map((c) => ({ value: `${r.alias}|${c.name}`, label: `${r.alias}.${c.name}`, meta: c.type }))),
  ];

  const plainDimRow = ({ d, j }: { d: SemanticDimensionV2; j: number }) =>
    canEdit ? (
      <HStack key={j} {...editRowProps}>
        <SchemaOptionPicker label={`semantic-model-${i}-dimension-${j}-field`}
          value={fieldValue(d)} options={fieldOptions()} placeholder="column…"
          emptyMessage="no columns found — pick a primary table first"
          onSelect={(v) => {
            const [source, column] = v.split('|');
            if (column) {
              patchDim(j, {
                ...d, source, column,
                name: followAutoName(d.name, humanizeName(d.column), humanizeName(column)),
              });
            }
          }} />
        <Text fontSize="xs" color="fg.subtle">→</Text>
        <DraftInput aria-label={`semantic-model-${i}-dimension-${j}-name`} maxW="180px"
          value={d.name} placeholder="name" onCommit={(v) => patchDim(j, { ...d, name: v })} />
        <Box flex={1} />
        <DeleteRowButton label={`semantic-model-${i}-dimension-${j}-delete`}
          onClick={() => patchModel({ dimensions: m.dimensions.filter((_, k) => k !== j) })} />
      </HStack>
    ) : (
      <React.Fragment key={j}>
        {readFieldRow(`semantic-model-${i}-dimension-${j}-definition`, LuTag, d.name, dimensionDefText(d))}
      </React.Fragment>
    );

  const metricRow = (mt: SemanticMetricV2, j: number) => (
    <VStack key={j} align="stretch" gap={1} px={canEdit ? 2 : 0} py={canEdit ? 1 : 0}
      borderBottom="1px solid" borderColor="border.muted" _last={{ borderBottom: 'none' }}>
      {/* Controls wrap INSIDE the left container; the delete button stays
          pinned top-right instead of drifting onto a wrapped line. */}
      <HStack gap={2} align={canEdit ? 'start' : 'center'}>
        <HStack gap={2} align="center" flexWrap="wrap" flex={1} minW={0}>
        {canEdit ? (
          <>
            <DraftInput aria-label={`semantic-model-${i}-metric-${j}-name`} maxW="140px"
              value={mt.name} placeholder="name" onCommit={(v) => patchMetric(j, { ...mt, name: v })} />
            <Text fontSize="xs" color="fg.subtle">=</Text>
            <SchemaOptionPicker label={`semantic-model-${i}-metric-${j}-type`} value={mt.type} minW="96px"
              options={[
                { value: 'aggregation', label: 'aggregation' },
                { value: 'ratio', label: 'ratio' },
                { value: 'sql', label: 'sql' },
              ]}
              onSelect={(v) => {
                const t = v as SemanticMetricV2['type'];
                if (t === mt.type) return;
                if (t === 'aggregation') patchMetric(j, { name: mt.name, type: 'aggregation', agg: 'COUNT', description: mt.description });
                else if (t === 'ratio') patchMetric(j, { name: mt.name, type: 'ratio', numerator: '', denominator: '', description: mt.description });
                else patchMetric(j, { name: mt.name, type: 'sql', sql: '', description: mt.description });
              }} />
            {mt.type === 'aggregation' && (
              <>
                <SchemaOptionPicker label={`semantic-model-${i}-metric-${j}-agg`} value={mt.agg} minW="90px"
                  options={AGGS.map((a) => ({ value: a, label: a }))}
                  onSelect={(v) => patchMetric(j, { ...mt, agg: v as typeof mt.agg })} />
                {columnPicker(`semantic-model-${i}-metric-${j}-column`, primaryColumns, mt.column ?? '',
                  (v) => patchMetric(j, {
                    ...mt, column: v || undefined,
                    name: followAutoName(mt.name, aggAutoName(mt.agg, mt.column ?? ''), aggAutoName(mt.agg, v)),
                  }),
                  { emptyOption: '(* — COUNT rows)' })}
              </>
            )}
            {mt.type === 'ratio' && (
              <>
                <SchemaOptionPicker label={`semantic-model-${i}-metric-${j}-numerator`}
                  value={mt.numerator} placeholder="numerator…"
                  options={aggMetricNames.map((n) => ({ value: n, label: n }))}
                  onSelect={(v) => patchMetric(j, { ...mt, numerator: v })} />
                <Text fontSize="xs" color="fg.subtle">÷</Text>
                <SchemaOptionPicker label={`semantic-model-${i}-metric-${j}-denominator`}
                  value={mt.denominator} placeholder="denominator…"
                  options={aggMetricNames.map((n) => ({ value: n, label: n }))}
                  onSelect={(v) => patchMetric(j, { ...mt, denominator: v })} />
              </>
            )}
            {mt.verified === false && <UnverifiedBadge label={`semantic-model-${i}-metric-${j}-unverified`} />}
          </>
        ) : (
          <Box flex={1}>
            {readFieldRow(`semantic-model-${i}-metric-${j}-definition`, LuSigma, mt.name, metricDefText(mt),
              mt.verified === false
                ? <UnverifiedBadge label={`semantic-model-${i}-metric-${j}-unverified`} />
                : undefined)}
          </Box>
        )}
        </HStack>
        {canEdit && (
          <Box pt={1.5}>
            <DeleteRowButton label={`semantic-model-${i}-metric-${j}-delete`}
              onClick={() => patchModel({ metrics: m.metrics.filter((_, k) => k !== j) })} />
          </Box>
        )}
      </HStack>
      {canEdit && mt.type === 'sql' && (
        <VStack align="stretch" gap={0.5}>
          <DraftTextarea aria-label={`semantic-model-${i}-metric-${j}-sql`}
            value={mt.sql} placeholder="SUM(primary.amount) - SUM(costs.total)"
            onCommit={(v) => patchMetric(j, { ...mt, sql: v })} />
          <Text fontSize="2xs" color="fg.subtle">qualify columns as primary.&lt;col&gt; or &lt;alias&gt;.&lt;col&gt;</Text>
        </VStack>
      )}
      {metricIssues(j).length > 0 && (
        <IssueList label={`semantic-model-${i}-metric-${j}-issue`} issues={metricIssues(j)} />
      )}
    </VStack>
  );

  // ── compact row + expandable body ───────────────────────────────────────

  const dimCount = m.dimensions.length;
  const counts = [
    refs.length > 0 ? `${refs.length} ${refs.length === 1 ? 'ref' : 'refs'}` : '',
    `${dimCount} dims`,
    `${m.metrics.length} metrics`,
  ].filter(Boolean).join(' · ');

  return (
    <Box borderBottom="1px solid" borderColor="border.muted" _last={{ borderBottom: 'none' }}>
      <HStack
        aria-label={`semantic-model-row-${inherited ? `inherited-${m.name}` : m.name}`}
        pl={3} pr={3} py={1.5} gap={1.5} cursor="pointer" width="100%"
        _hover={{ bg: 'bg.muted' }} transition="background 0.1s"
        opacity={inherited ? 0.75 : 1}
        onClick={onToggle}
      >
        <Box
          as="button"
          aria-label={`toggle-semantic-model-${m.name}`}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggle(); }}
          color="fg.subtle" cursor="pointer" flexShrink={0} lineHeight={1}
        >
          <Icon as={open ? LuChevronDown : LuChevronRight} boxSize={3} transition="transform 0.15s" />
        </Box>
        <Icon as={LuBoxes} boxSize={3} color="accent.teal" flexShrink={0} />
        <Text fontSize="xs" fontWeight="600" fontFamily="mono" flexShrink={0}
          textOverflow="ellipsis" overflow="hidden" whiteSpace="nowrap" maxW="240px" title={m.name}>
          {m.name}
        </Text>
        <Text flex={1} minW={0} fontSize="2xs" color="fg.muted" truncate>
          {m.description || (primaryLabel ? `on ${primaryLabel}` : '')}
        </Text>
        <HStack gap={2} flexShrink={0} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          {(modelIssues.length > 0 || m.metrics.some((_, j) => metricIssues(j).length > 0)) && (
            <Icon as={LuTriangleAlert} boxSize={3} color="accent.danger" />
          )}
          {canEdit && canTest && testStatus === 'ok' && (
            <HStack aria-label={`semantic-model-${i}-test-ok`} gap={1} px={1.5} py={0.5}
              bg="accent.success/10" borderRadius="sm">
              <Icon as={LuCircleCheck} boxSize={3} color="accent.success" />
              <Text fontSize="10px" fontWeight="600" color="accent.success" fontFamily="mono">metrics verified</Text>
            </HStack>
          )}
          {canEdit && canTest && (
            <Box
              as="button" aria-label={`semantic-model-${i}-test`}
              display="flex" alignItems="center" gap={1} px={1.5} py={0.5}
              fontSize="10px" fontWeight="600" fontFamily="mono"
              color="accent.teal" borderRadius="sm"
              cursor={testStatus === 'running' ? 'wait' : 'pointer'} transition="all 0.15s"
              _hover={{ bg: 'accent.teal/10' }}
              onClick={() => testStatus !== 'running' && onTest?.()}
              title="Run the save-gate checks (including metric SQL against the warehouse) without saving"
            >
              <Icon as={LuFlaskConical} boxSize={3} />
              {testStatus === 'running' ? 'Testing…' : 'Test'}
            </Box>
          )}
          <Text fontSize="10px" fontWeight="600" color="fg.subtle" fontFamily="mono">{counts}</Text>
          {inherited && (
            <Text fontSize="10px" fontWeight="600" color="accent.teal" fontFamily="mono">inherited</Text>
          )}
          {canEdit && (
            <DeleteRowButton label={`delete-semantic-model-${m.name}`} onClick={onDelete} />
          )}
        </HStack>
      </HStack>

      {open && (
        <VStack align="stretch" gap={2.5} px={3} py={2.5} pl={8}
          borderTop="1px solid" borderColor="border.muted" bg="bg.surface">
          {modelIssues.length > 0 && (
            <IssueList label={`semantic-model-${i}-issues`} issues={modelIssues} />
          )}

          {/* Identity line: name — description · primary source · grain */}
          {canEdit ? (
            <VStack align="stretch" gap={1.5}>
              <HStack gap={2} align="center">
                <DraftInput aria-label={`semantic-model-${i}-name`} fontFamily="mono" fontWeight="600" maxW="200px"
                  value={m.name} placeholder="model name" onCommit={commitName} />
                <DraftInput aria-label={`semantic-model-${i}-description`} flex={1} minW="120px"
                  value={m.description ?? ''} placeholder="description"
                  onCommit={(v) => patchModel({ description: v || undefined })} />
              </HStack>
              <HStack gap={2} align="center" flexWrap="wrap">
                <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.04em">on</Text>
                <SchemaOptionPicker label={`semantic-model-${i}-primary-source`}
                  value={encodeSource(m.primary)} options={sourcePickerOptions(options)}
                  onSelect={onPrimaryPicked} placeholder="pick table…" minW="180px" />
                {(hasM2M || (m.primaryKey?.length ?? 0) > 0) && (
                  <HStack gap={1} align="center" title="The model's grain (primary key) — required for many-to-many">
                    <Icon as={LuKeyRound} boxSize={3} color="fg.subtle" />
                    <SchemaOptionPicker label={`semantic-model-${i}-primary-key`} minW="90px"
                      value={m.primaryKey?.[0] ?? ''} placeholder="grain…"
                      options={[
                        ...columnPickerOptions(primaryColumns),
                        ...(m.primaryKey && m.primaryKey.length > 1
                          && !primaryColumns.some((c) => c.name === m.primaryKey![0])
                          ? [{ value: m.primaryKey[0], label: m.primaryKey.join(', ') }] : []),
                      ]}
                      onSelect={(v) => patchModel({ primaryKey: v ? [v] : undefined })} />
                  </HStack>
                )}
              </HStack>
            </VStack>
          ) : (
            <HStack gap={2} align="center" flexWrap="wrap">
              <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.04em">on</Text>
              <DefText muted={false}>{primaryLabel || '—'}</DefText>
              {(m.primaryKey?.length ?? 0) > 0 && (
                <HStack gap={1} align="center" title="The model's grain (primary key)">
                  <Icon as={LuKeyRound} boxSize={3} color="fg.subtle" />
                  <DefText>{(m.primaryKey ?? []).join(', ')}</DefText>
                </HStack>
              )}
            </HStack>
          )}

          {/* References span the full width (join lines are long); the
              dimension/metric vocabulary sits in explorer-style side-by-side
              field panels. */}
          {(canEdit || refs.length > 0) && (
            <FieldPanel>
              <GroupBar icon={LuLink2} label="References" count={refs.length}
                {...(canEdit ? {
                  addLabel: `semantic-model-${i}-add-reference`,
                  onAdd: () => patchModel({
                    references: [...refs, {
                      source: { kind: 'table', table: '' }, alias: '', relationship: 'many_to_one',
                      on: [{ primaryColumn: '', referencedColumn: '' }],
                    }],
                  }),
                } : {})} />
              {refs.map(referenceRow)}
            </FieldPanel>
          )}

          <SimpleGrid columns={{ base: 1, lg: 2 }} gap={2.5} alignItems="start">
            {(canEdit || m.dimensions.length > 0) && (
              <FieldPanel>
                {(canEdit || timeDims.length > 0) && (
                  <Box aria-label={`semantic-model-${i}-time-dimensions`}>
                    <GroupBar icon={LuCalendarDays} label="Time Dimensions" count={timeDims.length}
                      {...(canEdit ? {
                        addLabel: `semantic-model-${i}-add-time-dimension`,
                        onAdd: () => patchModel({
                          dimensions: [...m.dimensions, { name: '', source: 'primary', column: '', temporal: true }],
                        }),
                      } : {})} />
                    {timeDims.map(timeDimRow)}
                  </Box>
                )}
                {(canEdit || plainDims.length > 0) && (
                  <Box aria-label={`semantic-model-${i}-plain-dimensions`}
                    borderTop={(canEdit || timeDims.length > 0) ? '1px solid' : undefined}
                    borderColor="border.muted">
                    <GroupBar icon={LuTag} label="Dimensions" count={plainDims.length}
                      {...(canEdit ? {
                        addLabel: `semantic-model-${i}-add-dimension`,
                        onAdd: () => patchModel({
                          dimensions: [...m.dimensions, { name: '', source: 'primary', column: '' }],
                        }),
                      } : {})} />
                    {plainDims.map(plainDimRow)}
                  </Box>
                )}
              </FieldPanel>
            )}

            {(canEdit || m.metrics.length > 0) && (
              <FieldPanel>
                <GroupBar icon={LuSigma} label="Metrics" count={m.metrics.length}
                  {...(canEdit ? {
                    addLabel: `semantic-model-${i}-add-metric`,
                    onAdd: () => patchModel({
                      metrics: [...m.metrics, { name: '', type: 'aggregation', agg: 'COUNT' }],
                    }),
                  } : {})} />
                {m.metrics.map(metricRow)}
              </FieldPanel>
            )}
          </SimpleGrid>
        </VStack>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

export default function SemanticModelsSection({
  connection, database, views, models, inheritedModels = [], editMode, onChange, issues = [], contextPath,
}: SemanticModelsSectionProps) {
  const options = useMemo(() => sourceOptionsFor(database, connection, views), [database, connection, views]);

  // Which model rows are expanded (keyed by model name; renames re-key).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (name: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const rekeyExpanded = (from: string, to: string) => setExpanded((prev) => {
    if (!prev.has(from) || from === to) return prev;
    return new Set([...prev].map((n) => (n === from ? to : n)));
  });

  // The Test button (save-gate tiers 1–3 for the STAGED model, no save):
  // per-model verdict + returned issues, both cleared by ANY edit — a stale
  // "verified" chip on a since-edited model would be a lie.
  const [testState, setTestState] = useState<Map<string, 'running' | 'ok'>>(new Map());
  const [testIssues, setTestIssues] = useState<Map<string, string[]>>(new Map());

  // LIVE tier-1 validation (pure, per commit): real violations — duplicate
  // names, dangling refs, bad columns — surface in the same inline slots the
  // save gate uses, without a save round-trip. Issues that merely describe an
  // INCOMPLETE row (empty names/columns render as "") are suppressed: a row
  // the author is still typing is not a violation yet.
  const liveIssues = useMemo(() => {
    if (!editMode) return [];
    const out: string[] = [];
    const seen = new Set(issues);
    for (const m of models) {
      if (!sourceName(m.primary)) continue; // no primary picked yet
      const ctx = {
        fullSchema: database ? [database] : [],
        views,
        otherModelNames: [
          ...inheritedModels.map((x) => x.name),
          ...models.filter((x) => x !== m).map((x) => x.name),
        ],
      };
      // Bounded (names-only) schema menus strip columns — field-level checks
      // would flag every column as "not exposed". Same degrade rule as the
      // EditFile path: skip live checks and let Test / the save gate (which
      // recompute the schema server-side) be the authority.
      if (!fieldChecksTrustworthy(m, ctx)) continue;
      for (const issue of validateSemanticModel(m, ctx)) {
        if (issue.includes('""') || issue === 'model name must not be empty') continue;
        const prefixed = `Semantic model "${m.name}": ${issue}`;
        if (!seen.has(prefixed)) { seen.add(prefixed); out.push(prefixed); }
      }
    }
    return out;
  }, [editMode, models, inheritedModels, database, views, issues]);

  const attributed = useMemo(
    () => attributeIssues([...issues, ...liveIssues, ...[...testIssues.values()].flat()], models),
    [issues, liveIssues, testIssues, models],
  );
  /** Join-pair pickers are hidden behind the join line; this opens them per reference. */
  const [openJoins, setOpenJoins] = useState<Set<string>>(new Set());

  /** Every internal mutation goes through here so test verdicts never go stale. */
  const emit = (next: SemanticModelV2[]) => {
    if (testState.size > 0) setTestState(new Map());
    if (testIssues.size > 0) setTestIssues(new Map());
    onChange(next);
  };

  const runTest = async (m: SemanticModelV2) => {
    if (!contextPath) return;
    setTestState((prev) => new Map(prev).set(m.name, 'running'));
    const result = await testSemanticModel(contextPath, m);
    setTestState((prev) => {
      const next = new Map(prev);
      if (result.issues.length === 0) next.set(m.name, 'ok'); else next.delete(m.name);
      return next;
    });
    setTestIssues((prev) => new Map(prev).set(m.name, result.issues));
  };

  const patchModel = (i: number, changes: Partial<SemanticModelV2>) =>
    emit(models.map((m, idx) => (idx === i ? { ...m, ...changes } : m)));

  const allNames = () => new Set([...models, ...inheritedModels].map((m) => m.name));

  const addModel = () => {
    const existing = allNames();
    let name = 'new_model';
    let suffix = 2;
    while (existing.has(name)) name = `new_model_${suffix++}`;
    // PREPENDED and pre-expanded — the new model must be visible and editable
    // without any scrolling or extra click.
    setExpanded((prev) => new Set(prev).add(name));
    emit([{
      name,
      connection,
      primary: { kind: 'table', table: '' },
      dimensions: [],
      metrics: [],
    }, ...models]);
  };

  /**
   * Primary picked on an empty model → prefill the whole draft vocabulary
   * (dimensions with temporal first, Count/Total/Avg metrics, inferred grain,
   * a name from the table) — one pick yields a working model to prune.
   * Columns resolve on demand (bounded schemas ship names-only).
   */
  const pickPrimary = async (i: number, value: string) => {
    const m = models[i];
    const primary = decodeSource(value) ?? { kind: 'table' as const, table: '' };
    const columns = await resolveColumns(primary, options, connection);
    const isEmpty = m.dimensions.length === 0 && m.metrics.length === 0;
    if (!isEmpty || columns.length === 0) {
      patchModel(i, { primary });
      return;
    }
    const draft = deriveSemanticModels([{
      databaseName: connection,
      schemas: [{
        schema: primary.kind === 'table' ? (primary.schema ?? '') : '_views',
        tables: [{ table: sourceName(primary), columns }],
      }],
    }])[0];
    const keepName = !/^new_model/.test(m.name);
    let name = keepName ? m.name : humanizeName(sourceName(primary));
    const taken = allNames();
    taken.delete(m.name);
    let suffix = 2;
    while (taken.has(name)) name = `${humanizeName(sourceName(primary))} ${suffix++}`;
    rekeyExpanded(m.name, name);
    patchModel(i, {
      primary,
      name,
      dimensions: draft?.dimensions ?? [],
      metrics: draft?.metrics ?? [],
      ...(inferPrimaryKey(columns, sourceName(primary)) ? { primaryKey: inferPrimaryKey(columns, sourceName(primary))! } : {}),
    });
  };

  const commitName = (i: number, name: string) => {
    rekeyExpanded(models[i].name, name);
    patchModel(i, { name });
  };

  const visibleInherited = inheritedModels.filter((im) => !models.some((m) => m.name === im.name));
  if (!editMode && models.length === 0 && visibleInherited.length === 0) return null;

  const renderModel = (m: SemanticModelV2, i: number, inherited: boolean) => {
    const modelIssues = inherited ? [] : attributed.byModel.get(i) ?? [];
    const metricIssues = (j: number) => (inherited ? [] : attributed.byMetric.get(`${i}:${j}`) ?? []);
    const hasIssues = modelIssues.length > 0 || m.metrics.some((_, j) => metricIssues(j).length > 0);
    return (
      <ModelCard
        key={`${inherited ? 'inh' : 'own'}-${m.name}`}
        m={m} i={i} inherited={inherited}
        // A row with attributed issues force-opens — errors never hide
        // behind a collapsed row.
        open={expanded.has(m.name) || hasIssues}
        onToggle={() => toggleExpanded(m.name)}
        editMode={editMode}
        connection={connection}
        options={options}
        modelIssues={modelIssues}
        metricIssues={metricIssues}
        testStatus={testState.get(m.name)}
        canTest={!!contextPath}
        onTest={() => runTest(m)}
        patchModel={(changes) => patchModel(i, changes)}
        commitName={(name) => commitName(i, name)}
        onDelete={() => emit(models.filter((_, idx) => idx !== i))}
        onPrimaryPicked={(value) => pickPrimary(i, value)}
        openJoins={openJoins}
        toggleJoinOpen={(j) => setOpenJoins((prev) => {
          const next = new Set(prev);
          const key = `${m.name}:${j}`;
          if (next.has(key)) next.delete(key); else next.add(key);
          return next;
        })}
      />
    );
  };

  return (
    <Box aria-label={`Semantic models for ${connection}`} mb={4}
      border="1px solid" borderColor="border.muted" borderRadius="md" overflow="hidden">
      <HStack px={3} py={1} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted" gap={1.5}>
        <Icon as={LuBoxes} boxSize={3} color="accent.teal" />
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.02em">
          Semantic Models
        </Text>
        {models.length + visibleInherited.length > 0 && (
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">{models.length + visibleInherited.length}</Text>
        )}
      </HStack>

      {attributed.unattributed.length > 0 && (
        <Box px={3} py={2}>
          <IssueList label="semantic-model-unattributed-issues" issues={attributed.unattributed} />
        </Box>
      )}

      {editMode && models.length === 0 && visibleInherited.length === 0 && (
        <Text px={3} py={2} fontSize="xs" color="fg.muted">
          No semantic models yet — add one to expose curated dimensions and metrics for this connection.
        </Text>
      )}

      {models.map((m, i) => renderModel(m, i, false))}
      {visibleInherited.map((m, i) => renderModel(m, models.length + i, true))}

      {editMode && (
        <Box px={3} py={1}>
          <Button aria-label="add-semantic-model" size="2xs" variant="ghost" onClick={addModel}
            title="New semantic model">
            <LuPlus /> New Semantic Model
          </Button>
        </Box>
      )}
    </Box>
  );
}
