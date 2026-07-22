'use client';

/**
 * SemanticModelsSection — the per-connection semantic-model editor, rendered
 * inside the Databases tab ABOVE Data Models. The connection is implied by the
 * database section it lives in — a model here never picks a connection.
 *
 * ONE layout for both modes: read mode renders the same cards with every
 * definition as text (metric formulas, dimension mappings, join equalities);
 * edit mode swaps the text for inputs in place. There is no separate catalog.
 *
 * Sections per card: References · Time Dimensions · Dimensions · Metrics, each
 * with a compact `+` on its heading. Join columns are INFERRED on source pick
 * (lib/semantic/infer-join) and always DISPLAYED as real `table.column =
 * table.column` equalities — never as "primary/bridge/referenced" jargon; the
 * pair pickers only appear when inference fails or the author expands them.
 *
 * Edits flow up as this connection's next `models` array; save-time tier-1/2/3
 * validation happens server-side in the context save gate and surfaces through
 * `issues` (attributed inline to the model / metric row each one names).
 */

import React, { useMemo, useState } from 'react';
import { Box, VStack, HStack, Text, Input, Icon } from '@chakra-ui/react';
import { LuPlus, LuTrash2, LuBoxes, LuTriangleAlert, LuPencil, LuKeyRound, LuFlaskConical, LuCircleCheck } from 'react-icons/lu';
import { exposedColumns } from '@/lib/types/views';
import { deriveSemanticModels, humanizeName } from '@/lib/semantic/derive';
import { validateSemanticModel } from '@/lib/semantic/validate';
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
  /** That connection's schema (source + column pickers). */
  database: DatabaseWithSchema | undefined;
  /** Views visible in this context (own + inherited); filtered by connection here. */
  views: ViewDef[];
  /** THIS CONNECTION's authored models (the parent owns the full array). */
  models: SemanticModelV2[];
  /** Inherited models on this connection (read-only cards). */
  inheritedModels?: SemanticModelV2[];
  editMode: boolean;
  onChange: (next: SemanticModelV2[]) => void;
  /** Save-gate issues (all of them — this section attributes its own). */
  issues?: string[];
  /** Path of the context file — the Test button validates against it. */
  contextPath?: string;
}

type Column = { name: string; type: string };
type SourceOption = { value: string; label: string; columns: Column[] };

const AGGS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT'] as const;
const TEMPORAL_TYPE = /date|time/i;

const selectStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'var(--font-jetbrains-mono), monospace',
  padding: '0 6px',
  border: '1px solid var(--chakra-colors-border-muted)',
  borderRadius: '6px',
  background: 'var(--chakra-colors-bg-canvas)',
  color: 'var(--chakra-colors-fg-default)',
  outline: 'none',
  height: '26px',
  cursor: 'pointer',
  minWidth: '110px',
  maxWidth: '240px',
};

// ---------------------------------------------------------------------------
// Source encoding — a SemanticSource as a stable <select> value.
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
      columns: t.columns,
    })));
  const viewOpts: SourceOption[] = views
    .filter((v) => v.connection === connection)
    .map((v) => ({ value: `v|${v.name}`, label: `_views.${v.name}`, columns: exposedColumns(v) }));
  return [...tables, ...viewOpts];
}

const columnsOfSource = (source: SemanticSource | undefined, options: SourceOption[]): Column[] =>
  options.find((o) => o.value === encodeSource(source))?.columns ?? [];

/** How a source is spelled in a join equality: its table/view NAME. */
const sourceName = (s: SemanticSource | undefined): string =>
  !s ? '' : s.kind === 'table' ? s.table : s.view;

const isM2M = (r: SemanticReference): r is SemanticReferenceM2M => r.relationship === 'many_to_many';

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
// Small shared pieces
// ---------------------------------------------------------------------------

function ColumnSelect({ label, columns, value, onChange, emptyLabel = 'column…' }: {
  label: string; columns: Column[]; value: string; onChange: (v: string) => void; emptyLabel?: string;
}) {
  return (
    <select aria-label={label} style={selectStyle} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      {value && !columns.some((c) => c.name === value) && <option value={value}>{value}</option>}
    </select>
  );
}

function SourceSelect({ label, options, value, onChange }: {
  label: string; options: SourceOption[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <select aria-label={label} style={selectStyle} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">pick table…</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {value && !options.some((o) => o.value === value) && <option value={value}>{value}</option>}
    </select>
  );
}

/** Section heading with count and (edit mode) a compact + button. */
function SectionHeading({ label, count, onAdd, addLabel }: {
  label: string; count: number; onAdd?: () => void; addLabel?: string;
}) {
  return (
    <HStack gap={1.5} align="center">
      <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.04em">
        {label}
      </Text>
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

function DeleteRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Box as="button" aria-label={label} onClick={onClick} color="fg.subtle" cursor="pointer"
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
// The section
// ---------------------------------------------------------------------------

export default function SemanticModelsSection({
  connection, database, views, models, inheritedModels = [], editMode, onChange, issues = [], contextPath,
}: SemanticModelsSectionProps) {
  const options = useMemo(() => sourceOptionsFor(database, connection, views), [database, connection, views]);

  // The Test button (save-gate tiers 1–3 for the STAGED model, no save):
  // per-model verdict + returned issues, both cleared by ANY edit — a stale
  // "verified" chip on a since-edited model would be a lie.
  const [testState, setTestState] = useState<Map<string, 'running' | 'ok'>>(new Map());
  const [testIssues, setTestIssues] = useState<Map<string, string[]>>(new Map());

  // LIVE tier-1 validation (pure, per keystroke): real violations — duplicate
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
    // PREPENDED — the new card must be visible without scrolling.
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
   */
  const pickPrimary = (i: number, value: string) => {
    const m = models[i];
    const primary = decodeSource(value) ?? { kind: 'table' as const, table: '' };
    const columns = columnsOfSource(primary, options);
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
    patchModel(i, {
      primary,
      name,
      dimensions: draft?.dimensions ?? [],
      metrics: draft?.metrics ?? [],
      ...(inferPrimaryKey(columns, sourceName(primary)) ? { primaryKey: inferPrimaryKey(columns, sourceName(primary))! } : {}),
    });
  };

  // -------------------------------------------------------------------------
  // One model card (same structure in both modes)
  // -------------------------------------------------------------------------

  const renderModel = (m: SemanticModelV2, i: number, inherited: boolean) => {
    const canEdit = editMode && !inherited;
    const primaryColumns = columnsOfSource(m.primary, options);
    const refs = m.references ?? [];
    const hasM2M = refs.some(isM2M);
    const modelIssues = attributed.byModel.get(i) ?? [];
    const metricIssues = (j: number) => (inherited ? [] : attributed.byMetric.get(`${i}:${j}`) ?? []);
    const aggMetricNames = m.metrics.filter((mt) => mt.type === 'aggregation').map((mt) => mt.name);
    const temporalColumns = primaryColumns.filter((c) => TEMPORAL_TYPE.test(c.type));
    const timeDims = m.dimensions.map((d, j) => ({ d, j })).filter(({ d }) => d.temporal);
    const plainDims = m.dimensions.map((d, j) => ({ d, j })).filter(({ d }) => !d.temporal);

    const patchRef = (j: number, next: SemanticReference) =>
      patchModel(i, { references: refs.map((r, k) => (k === j ? next : r)) });
    const patchMetric = (j: number, next: SemanticMetricV2) =>
      patchModel(i, { metrics: m.metrics.map((mt, k) => (k === j ? next : mt)) });
    const patchDim = (j: number, next: SemanticDimensionV2) =>
      patchModel(i, { dimensions: m.dimensions.map((d, k) => (k === j ? next : d)) });

    /** Source pick on a reference: infer alias + join columns in one shot. */
    const pickRefSource = (j: number, value: string) => {
      const r = refs[j];
      const source = decodeSource(value) ?? { kind: 'table' as const, table: '' };
      const refColumns = columnsOfSource(source, options);
      const autoAlias = r.alias === '' || r.alias === singularize(sourceName(r.source));
      const alias = autoAlias && sourceName(source) ? singularize(sourceName(source)) : r.alias;
      if (isM2M(r)) {
        patchRef(j, { ...r, source, alias });
        return;
      }
      const inferred = inferToOneOn(primaryColumns, refColumns, sourceName(source));
      patchRef(j, { ...r, source, alias, on: inferred ?? [{ primaryColumn: '', referencedColumn: '' }] });
    };

    /** Via (bridge) pick on an m2m reference: infer the whole through + grain. */
    const pickViaSource = (j: number, value: string) => {
      const r = refs[j];
      if (!isM2M(r)) return;
      const via = decodeSource(value) ?? { kind: 'table' as const, table: '' };
      const inferred = inferM2MThrough({
        primaryKey: m.primaryKey ?? [],
        primaryColumns,
        bridgeColumns: columnsOfSource(via, options),
        refColumns: columnsOfSource(r.source, options),
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
          : inferPrimaryKey(primaryColumns, sourceName(m.primary)) ?? undefined;
      patchModel(i, {
        references: refs.map((x, k) => (k === j ? nextRef : x)),
        ...(grain ? { primaryKey: grain } : {}),
      });
    };

    const renameAlias = (j: number, next: string) => {
      const r = refs[j];
      // Cascade: dimensions carry the alias in `source` — a rename without
      // this leaves them dangling and the save gate rejects the whole model.
      patchModel(i, {
        references: refs.map((x, k) => (k === j ? { ...x, alias: next } : x)),
        dimensions: m.dimensions.map((d) => (d.source === r.alias ? { ...d, source: next } : d)),
      });
    };

    const joinKey = (j: number) => `${m.name}:${j}`;
    const toggleJoinOpen = (j: number) => setOpenJoins((prev) => {
      const next = new Set(prev);
      const key = joinKey(j);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

    // ── rows ────────────────────────────────────────────────────────────────

    const referenceRow = (r: SemanticReference, j: number) => {
      const refColumns = columnsOfSource(r.source, options);
      const viaColumns = isM2M(r) ? columnsOfSource(r.through.source, options) : [];
      const showPairs = canEdit && (openJoins.has(joinKey(j)) || !refComplete(r));
      const base = sourceName(m.primary);
      const far = sourceName(r.source);
      const via = isM2M(r) ? sourceName(r.through.source) : '';
      return (
        <VStack key={j} align="stretch" gap={1} py={1}>
          <HStack gap={2} flexWrap="wrap" align="center">
            {canEdit ? (
              <>
                <Input aria-label={`semantic-model-${i}-reference-${j}-alias`} size="2xs" fontFamily="mono" maxW="110px"
                  value={r.alias} placeholder="alias"
                  onChange={(e) => renameAlias(j, e.target.value)} />
                <Text fontSize="xs" color="fg.subtle">·</Text>
                <SourceSelect label={`semantic-model-${i}-reference-${j}-source`} options={options}
                  value={encodeSource(r.source)} onChange={(v) => pickRefSource(j, v)} />
                <select aria-label={`semantic-model-${i}-reference-${j}-relationship`} style={selectStyle}
                  value={r.relationship}
                  onChange={(e) => {
                    const rel = e.target.value as SemanticReference['relationship'];
                    if (rel === 'many_to_many') {
                      patchRef(j, {
                        source: r.source, alias: r.alias, relationship: 'many_to_many',
                        through: {
                          source: { kind: 'table', table: '' },
                          primaryOn: [{ primaryColumn: '', bridgeColumn: '' }],
                          referencedOn: [{ bridgeColumn: '', referencedColumn: '' }],
                        },
                      });
                    } else {
                      const on = !isM2M(r) && r.on.length > 0 ? r.on
                        : inferToOneOn(primaryColumns, refColumns, sourceName(r.source)) ?? [{ primaryColumn: '', referencedColumn: '' }];
                      patchRef(j, { source: r.source, alias: r.alias, relationship: rel, on });
                    }
                  }}>
                  <option value="many_to_one">many-to-one</option>
                  <option value="one_to_one">one-to-one</option>
                  <option value="many_to_many">many-to-many</option>
                </select>
                {isM2M(r) && (
                  <>
                    <Text fontSize="xs" color="fg.muted" flexShrink={0}>via</Text>
                    <SourceSelect label={`semantic-model-${i}-reference-${j}-via-source`} options={options}
                      value={encodeSource(r.through.source)} onChange={(v) => pickViaSource(j, v)} />
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
                  onClick={() => patchModel(i, { references: refs.filter((_, k) => k !== j) })} />
              </>
            ) : (
              <DefText muted={false}>
                <Text as="span" fontWeight="600">{r.alias}</Text>
                <Text as="span" color="fg.muted"> · {far || '—'} — {relationshipText[r.relationship]}{isM2M(r) && via ? ` via ${via}` : ''}</Text>
              </DefText>
            )}
          </HStack>
          {/* The join, ALWAYS as real column equalities. */}
          <Box pl={canEdit ? 0 : 0}>
            <DefText label={`semantic-model-${i}-reference-${j}-join`}>
              {joinText(m, r) || 'join columns not set'}
            </DefText>
          </Box>
          {showPairs && !isM2M(r) && (
            <VStack align="stretch" gap={1}>
              {r.on.map((pair, k) => (
                <HStack key={k} gap={1.5} flexWrap="wrap">
                  <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{base}.</Text>
                  <ColumnSelect label={`semantic-model-${i}-reference-${j}-on-${k}-primary-column`}
                    columns={primaryColumns} value={pair.primaryColumn}
                    onChange={(v) => patchRef(j, { ...r, on: r.on.map((p, x) => (x === k ? { ...p, primaryColumn: v } : p)) })} />
                  <Text fontSize="xs" color="fg.subtle">=</Text>
                  <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{far}.</Text>
                  <ColumnSelect label={`semantic-model-${i}-reference-${j}-on-${k}-referenced-column`}
                    columns={refColumns} value={pair.referencedColumn}
                    onChange={(v) => patchRef(j, { ...r, on: r.on.map((p, x) => (x === k ? { ...p, referencedColumn: v } : p)) })} />
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
                  <ColumnSelect label={`semantic-model-${i}-reference-${j}-primary-on-primary-column`}
                    columns={primaryColumns} value={primaryOn.primaryColumn}
                    onChange={(v) => patchRef(j, { ...r, through: { ...r.through, primaryOn: [{ ...primaryOn, primaryColumn: v }] } })} />
                  <Text fontSize="xs" color="fg.subtle">=</Text>
                  <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{via || 'via'}.</Text>
                  <ColumnSelect label={`semantic-model-${i}-reference-${j}-primary-on-bridge-column`}
                    columns={viaColumns} value={primaryOn.bridgeColumn}
                    onChange={(v) => patchRef(j, { ...r, through: { ...r.through, primaryOn: [{ ...primaryOn, bridgeColumn: v }] } })} />
                </HStack>
                <HStack gap={1.5} flexWrap="wrap">
                  <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{via || 'via'}.</Text>
                  <ColumnSelect label={`semantic-model-${i}-reference-${j}-referenced-on-bridge-column`}
                    columns={viaColumns} value={referencedOn.bridgeColumn}
                    onChange={(v) => patchRef(j, { ...r, through: { ...r.through, referencedOn: [{ ...referencedOn, bridgeColumn: v }] } })} />
                  <Text fontSize="xs" color="fg.subtle">=</Text>
                  <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>{far}.</Text>
                  <ColumnSelect label={`semantic-model-${i}-reference-${j}-referenced-on-referenced-column`}
                    columns={refColumns} value={referencedOn.referencedColumn}
                    onChange={(v) => patchRef(j, { ...r, through: { ...r.through, referencedOn: [{ ...referencedOn, referencedColumn: v }] } })} />
                </HStack>
              </VStack>
            );
          })()}
        </VStack>
      );
    };

    const timeDimRow = ({ d, j }: { d: SemanticDimensionV2; j: number }) => (
      <HStack key={j} gap={2} align="center" py={0.5}>
        {canEdit ? (
          <>
            <Input aria-label={`semantic-model-${i}-dimension-${j}-name`} size="2xs" maxW="180px"
              value={d.name} placeholder="name"
              onChange={(e) => patchDim(j, { ...d, name: e.target.value })} />
            <Text fontSize="xs" color="fg.subtle">←</Text>
            <ColumnSelect label={`semantic-model-${i}-dimension-${j}-column`}
              columns={temporalColumns.length > 0 ? temporalColumns : primaryColumns}
              value={d.column}
              onChange={(v) => patchDim(j, {
                ...d, column: v,
                name: followAutoName(d.name, humanizeName(d.column), humanizeName(v)),
              })} />
            <Box flex={1} />
            <DeleteRowButton label={`semantic-model-${i}-dimension-${j}-delete`}
              onClick={() => patchModel(i, { dimensions: m.dimensions.filter((_, k) => k !== j) })} />
          </>
        ) : (
          <DefText label={`semantic-model-${i}-dimension-${j}-definition`} muted={false}>
            <Text as="span" fontWeight="600">{d.name}</Text>
            <Text as="span" color="fg.muted"> ← {dimensionDefText(d)}</Text>
          </DefText>
        )}
      </HStack>
    );

    // Combined source+column pick for a plain dimension: one select, values
    // `primary|<col>` and `<alias>|<col>` — two dropdowns collapsed into one.
    const fieldValue = (d: SemanticDimensionV2) => (d.column ? `${d.source}|${d.column}` : '');
    const fieldOptions = (): Array<{ value: string; label: string }> => [
      ...primaryColumns.map((c) => ({ value: `primary|${c.name}`, label: c.name })),
      ...refs.filter((r) => r.alias).flatMap((r) =>
        columnsOfSource(r.source, options).map((c) => ({ value: `${r.alias}|${c.name}`, label: `${r.alias}.${c.name}` }))),
    ];

    const plainDimRow = ({ d, j }: { d: SemanticDimensionV2; j: number }) => (
      <HStack key={j} gap={2} align="center" py={0.5}>
        {canEdit ? (
          <>
            <Input aria-label={`semantic-model-${i}-dimension-${j}-name`} size="2xs" maxW="180px"
              value={d.name} placeholder="name"
              onChange={(e) => patchDim(j, { ...d, name: e.target.value })} />
            <Text fontSize="xs" color="fg.subtle">←</Text>
            <select aria-label={`semantic-model-${i}-dimension-${j}-field`} style={selectStyle}
              value={fieldValue(d)}
              onChange={(e) => {
                const [source, column] = e.target.value.split('|');
                if (column) {
                  patchDim(j, {
                    ...d, source, column,
                    name: followAutoName(d.name, humanizeName(d.column), humanizeName(column)),
                  });
                }
              }}>
              <option value="">column…</option>
              {fieldOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {fieldValue(d) && !fieldOptions().some((o) => o.value === fieldValue(d)) &&
                <option value={fieldValue(d)}>{dimensionDefText(d)}</option>}
            </select>
            <Box flex={1} />
            <DeleteRowButton label={`semantic-model-${i}-dimension-${j}-delete`}
              onClick={() => patchModel(i, { dimensions: m.dimensions.filter((_, k) => k !== j) })} />
          </>
        ) : (
          <DefText label={`semantic-model-${i}-dimension-${j}-definition`} muted={false}>
            <Text as="span" fontWeight="600">{d.name}</Text>
            <Text as="span" color="fg.muted"> ← {dimensionDefText(d)}</Text>
          </DefText>
        )}
      </HStack>
    );

    const metricRow = (mt: SemanticMetricV2, j: number) => (
      <VStack key={j} align="stretch" gap={1} py={0.5}>
        <HStack gap={2} align="center" flexWrap="wrap">
          {canEdit ? (
            <>
              <Input aria-label={`semantic-model-${i}-metric-${j}-name`} size="2xs" maxW="180px"
                value={mt.name} placeholder="name"
                onChange={(e) => patchMetric(j, { ...mt, name: e.target.value })} />
              <Text fontSize="xs" color="fg.subtle">=</Text>
              <select aria-label={`semantic-model-${i}-metric-${j}-type`} style={{ ...selectStyle, minWidth: '96px' }}
                value={mt.type}
                onChange={(e) => {
                  const t = e.target.value as SemanticMetricV2['type'];
                  if (t === mt.type) return;
                  if (t === 'aggregation') patchMetric(j, { name: mt.name, type: 'aggregation', agg: 'COUNT', description: mt.description });
                  else if (t === 'ratio') patchMetric(j, { name: mt.name, type: 'ratio', numerator: '', denominator: '', description: mt.description });
                  else patchMetric(j, { name: mt.name, type: 'sql', sql: '', description: mt.description });
                }}>
                <option value="aggregation">aggregation</option>
                <option value="ratio">ratio</option>
                <option value="sql">sql</option>
              </select>
              {mt.type === 'aggregation' && (
                <>
                  <select aria-label={`semantic-model-${i}-metric-${j}-agg`} style={{ ...selectStyle, minWidth: '90px' }}
                    value={mt.agg}
                    onChange={(e) => patchMetric(j, { ...mt, agg: e.target.value as typeof mt.agg })}>
                    {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <ColumnSelect label={`semantic-model-${i}-metric-${j}-column`} columns={primaryColumns}
                    value={mt.column ?? ''} emptyLabel="(* — COUNT rows)"
                    onChange={(v) => patchMetric(j, {
                      ...mt, column: v || undefined,
                      name: followAutoName(mt.name, aggAutoName(mt.agg, mt.column ?? ''), aggAutoName(mt.agg, v)),
                    })} />
                </>
              )}
              {mt.type === 'ratio' && (
                <>
                  <select aria-label={`semantic-model-${i}-metric-${j}-numerator`} style={selectStyle} value={mt.numerator}
                    onChange={(e) => patchMetric(j, { ...mt, numerator: e.target.value })}>
                    <option value="">numerator…</option>
                    {aggMetricNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <Text fontSize="xs" color="fg.subtle">÷</Text>
                  <select aria-label={`semantic-model-${i}-metric-${j}-denominator`} style={selectStyle} value={mt.denominator}
                    onChange={(e) => patchMetric(j, { ...mt, denominator: e.target.value })}>
                    <option value="">denominator…</option>
                    {aggMetricNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </>
              )}
              {mt.verified === false && <UnverifiedBadge label={`semantic-model-${i}-metric-${j}-unverified`} />}
              <Box flex={1} />
              <DeleteRowButton label={`semantic-model-${i}-metric-${j}-delete`}
                onClick={() => patchModel(i, { metrics: m.metrics.filter((_, k) => k !== j) })} />
            </>
          ) : (
            <>
              <DefText label={`semantic-model-${i}-metric-${j}-definition`} muted={false}>
                <Text as="span" fontWeight="600">{mt.name}</Text>
                <Text as="span" color="fg.muted"> = {metricDefText(mt)}</Text>
              </DefText>
              {mt.verified === false && <UnverifiedBadge label={`semantic-model-${i}-metric-${j}-unverified`} />}
            </>
          )}
        </HStack>
        {canEdit && mt.type === 'sql' && (
          <VStack align="stretch" gap={0.5}>
            <textarea aria-label={`semantic-model-${i}-metric-${j}-sql`} rows={2}
              style={{
                fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: '12px',
                border: '1px solid var(--chakra-colors-border-muted)', borderRadius: '6px',
                background: 'var(--chakra-colors-bg-canvas)', color: 'var(--chakra-colors-fg-default)',
                padding: '6px 8px', outline: 'none', resize: 'vertical', width: '100%',
              }}
              value={mt.sql} placeholder="SUM(primary.amount) - SUM(costs.total)"
              onChange={(e) => patchMetric(j, { ...mt, sql: e.target.value })} />
            <Text fontSize="2xs" color="fg.subtle">qualify columns as primary.&lt;col&gt; or &lt;alias&gt;.&lt;col&gt;</Text>
          </VStack>
        )}
        {metricIssues(j).length > 0 && (
          <IssueList label={`semantic-model-${i}-metric-${j}-issue`} issues={metricIssues(j)} />
        )}
      </VStack>
    );

    // ── the card ────────────────────────────────────────────────────────────

    return (
      <Box key={`${inherited ? 'inh' : 'own'}-${m.name}-${i}`} aria-label={`semantic-model-${inherited ? `inherited-${m.name}` : i}`}
        border="1px solid" borderColor="border.default" borderRadius="md" bg="bg.surface" overflow="hidden">
        {/* Header: name — description · primary · grain · delete */}
        <VStack align="stretch" gap={1} px={3} py={2} bg="bg.muted" borderBottom="1px solid" borderColor="border.default">
          <HStack gap={2} align="center">
            <Icon as={LuBoxes} boxSize={3.5} color="accent.teal" flexShrink={0} />
            {canEdit ? (
              <>
                <Input aria-label={`semantic-model-${i}-name`} size="2xs" fontFamily="mono" fontWeight="600" maxW="200px"
                  value={m.name} placeholder="model name"
                  onChange={(e) => patchModel(i, { name: e.target.value })} />
                <Input aria-label={`semantic-model-${i}-description`} size="2xs" flex={1} minW="120px"
                  value={m.description ?? ''} placeholder="description"
                  onChange={(e) => patchModel(i, { description: e.target.value || undefined })} />
              </>
            ) : (
              <>
                <Text fontSize="sm" fontWeight="700" fontFamily="mono">{m.name}</Text>
                {inherited && <Text fontSize="10px" fontWeight="600" color="accent.teal" fontFamily="mono">inherited</Text>}
                {m.description && <Text fontSize="xs" color="fg.muted" truncate flex={1}>{m.description}</Text>}
              </>
            )}
            {canEdit && contextPath && (
              <>
                {testState.get(m.name) === 'ok' && (
                  <HStack aria-label={`semantic-model-${i}-test-ok`} gap={1} px={1.5} py={0.5}
                    bg="accent.success/10" borderRadius="sm" flexShrink={0}>
                    <Icon as={LuCircleCheck} boxSize={3} color="accent.success" />
                    <Text fontSize="10px" fontWeight="600" color="accent.success" fontFamily="mono">metrics verified</Text>
                  </HStack>
                )}
                <HStack as="button" aria-label={`semantic-model-${i}-test`} gap={1} px={2} py={0.5}
                  border="1px solid" borderColor="border.muted" borderRadius="md" flexShrink={0}
                  cursor={testState.get(m.name) === 'running' ? 'wait' : 'pointer'}
                  color="fg.muted" _hover={{ color: 'accent.teal', borderColor: 'accent.teal/40' }}
                  onClick={() => testState.get(m.name) !== 'running' && runTest(m)}
                  title="Run the save-gate checks (including metric SQL against the warehouse) without saving">
                  <Icon as={LuFlaskConical} boxSize={3} />
                  <Text fontSize="xs" fontFamily="mono" fontWeight="600">
                    {testState.get(m.name) === 'running' ? 'Testing…' : 'Test'}
                  </Text>
                </HStack>
              </>
            )}
            {canEdit && (
              <DeleteRowButton label={`delete-semantic-model-${m.name}`}
                onClick={() => emit(models.filter((_, idx) => idx !== i))} />
            )}
          </HStack>
          <HStack gap={2} align="center" flexWrap="wrap">
            {canEdit ? (
              <SourceSelect label={`semantic-model-${i}-primary-source`} options={options}
                value={encodeSource(m.primary)} onChange={(v) => pickPrimary(i, v)} />
            ) : (
              <DefText>{options.find((o) => o.value === encodeSource(m.primary))?.label ?? sourceName(m.primary) ?? '—'}</DefText>
            )}
            {(hasM2M || (m.primaryKey?.length ?? 0) > 0) && (
              <HStack gap={1} align="center" title="The model's grain (primary key) — required for many-to-many">
                <Icon as={LuKeyRound} boxSize={3} color="fg.subtle" />
                {canEdit ? (
                  <select aria-label={`semantic-model-${i}-primary-key`} style={{ ...selectStyle, minWidth: '90px' }}
                    value={m.primaryKey?.[0] ?? ''}
                    onChange={(e) => patchModel(i, { primaryKey: e.target.value ? [e.target.value] : undefined })}>
                    <option value="">grain…</option>
                    {primaryColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    {m.primaryKey && m.primaryKey.length > 1 && (
                      <option value={m.primaryKey[0]}>{m.primaryKey.join(', ')}</option>
                    )}
                  </select>
                ) : (
                  <DefText>{(m.primaryKey ?? []).join(', ')}</DefText>
                )}
              </HStack>
            )}
          </HStack>
        </VStack>

        <VStack align="stretch" gap={2.5} px={3} py={2.5}>
          {modelIssues.length > 0 && (
            <IssueList label={`semantic-model-${i}-issues`} issues={modelIssues} />
          )}

          {(canEdit || refs.length > 0) && (
            <VStack align="stretch" gap={0.5}>
              <SectionHeading label="References" count={refs.length}
                {...(canEdit ? {
                  addLabel: `semantic-model-${i}-add-reference`,
                  onAdd: () => patchModel(i, {
                    references: [...refs, {
                      source: { kind: 'table', table: '' }, alias: '', relationship: 'many_to_one',
                      on: [{ primaryColumn: '', referencedColumn: '' }],
                    }],
                  }),
                } : {})} />
              {refs.map(referenceRow)}
            </VStack>
          )}

          {(canEdit || timeDims.length > 0) && (
            <VStack align="stretch" gap={0.5} aria-label={`semantic-model-${i}-time-dimensions`}>
              <SectionHeading label="Time Dimensions" count={timeDims.length}
                {...(canEdit ? {
                  addLabel: `semantic-model-${i}-add-time-dimension`,
                  onAdd: () => patchModel(i, {
                    dimensions: [...m.dimensions, { name: '', source: 'primary', column: '', temporal: true }],
                  }),
                } : {})} />
              {timeDims.map(timeDimRow)}
            </VStack>
          )}

          {(canEdit || plainDims.length > 0) && (
            <VStack align="stretch" gap={0.5} aria-label={`semantic-model-${i}-plain-dimensions`}>
              <SectionHeading label="Dimensions" count={plainDims.length}
                {...(canEdit ? {
                  addLabel: `semantic-model-${i}-add-dimension`,
                  onAdd: () => patchModel(i, {
                    dimensions: [...m.dimensions, { name: '', source: 'primary', column: '' }],
                  }),
                } : {})} />
              {plainDims.map(plainDimRow)}
            </VStack>
          )}

          {(canEdit || m.metrics.length > 0) && (
            <VStack align="stretch" gap={0.5}>
              <SectionHeading label="Metrics" count={m.metrics.length}
                {...(canEdit ? {
                  addLabel: `semantic-model-${i}-add-metric`,
                  onAdd: () => patchModel(i, {
                    metrics: [...m.metrics, { name: '', type: 'aggregation', agg: 'COUNT' }],
                  }),
                } : {})} />
              {m.metrics.map(metricRow)}
            </VStack>
          )}
        </VStack>
      </Box>
    );
  };

  const visibleInherited = inheritedModels.filter((im) => !models.some((m) => m.name === im.name));
  if (!editMode && models.length === 0 && visibleInherited.length === 0) return null;

  return (
    <VStack align="stretch" gap={2} aria-label={`Semantic models for ${connection}`}>
      <HStack gap={1.5} align="center">
        <Icon as={LuBoxes} boxSize={3.5} color="accent.teal" />
        <Text fontSize="sm" fontWeight="700" fontFamily="mono">Semantic Models</Text>
        {models.length + visibleInherited.length > 0 && (
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">{models.length + visibleInherited.length}</Text>
        )}
        {editMode && (
          <Box as="button" aria-label="add-semantic-model" onClick={addModel} color="fg.subtle" cursor="pointer"
            borderRadius="sm" px={0.5} _hover={{ color: 'accent.teal', bg: 'bg.muted' }} lineHeight={1}
            title="New semantic model">
            <Icon as={LuPlus} boxSize={3.5} />
          </Box>
        )}
      </HStack>
      {attributed.unattributed.length > 0 && (
        <IssueList label="semantic-model-unattributed-issues" issues={attributed.unattributed} />
      )}
      {editMode && models.length === 0 && visibleInherited.length === 0 && (
        <Text fontSize="xs" color="fg.muted">
          No semantic models yet — add one to expose curated dimensions and metrics for this connection.
        </Text>
      )}
      {models.map((m, i) => renderModel(m, i, false))}
      {visibleInherited.map((m, i) => renderModel(m, models.length + i, true))}
    </VStack>
  );
}
