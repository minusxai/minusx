'use client';

/**
 * SemanticModelsEditor — M5b form-based editor + catalog for authored semantic
 * models (`SemanticModelV2`, stored on ContextVersion.semanticModels).
 *
 * Minimal contract (Semantic_Model_v2.md §6 M5b): lists and pickers — no
 * drag-drop, no live previews, no diagrams. The connection is fixed by picking
 * the primary: the connection select scopes every source picker (primary,
 * references, m2m bridge) to that connection's tables AND views (`_views`).
 * Edits flow up as the full next `semanticModels` array (same onChange pattern
 * as views); save-time tier-1/2/3 validation happens server-side in the
 * context save gate and surfaces through the editor's existing save-error path.
 *
 * Two modes: Edit (the form) and Catalog — a read-only browse surface listing
 * ONLY business names (dimensions + measures + metrics, no tables/SQL),
 * grouped under each model's connection. Outside edit mode only the catalog
 * renders.
 */

import React, { useMemo, useState } from 'react';
import { Box, VStack, HStack, Text, Button, Input, Textarea, Icon } from '@chakra-ui/react';
import { LuPlus, LuTrash2, LuBoxes, LuTriangleAlert } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';
import { exposedColumns, VIEWS_SCHEMA } from '@/lib/types/views';
import { deriveSemanticModels } from '@/lib/semantic/derive';
import type {
  DatabaseWithSchema, ViewDef,
  SemanticModelV2, SemanticSource, SemanticReference, SemanticMetricV2,
} from '@/lib/types';

interface SemanticModelsEditorProps {
  /** This context version's own models (edited in place). */
  models: SemanticModelV2[];
  /** Inherited models (read-only; shown in the catalog). */
  inheritedModels?: SemanticModelV2[];
  /** Available connections + schemas (parentSchema from the editor). */
  databases: DatabaseWithSchema[];
  /** Views (own + inherited) — sources alongside raw tables. */
  views: ViewDef[];
  editMode: boolean;
  onChange: (next: SemanticModelV2[]) => void;
  /**
   * Save-gate issues (tiers 1–3) exactly as the gate emitted them, i.e. still
   * prefixed `Semantic model "<name>": …`. Recover the list from a save-error
   * message with `parseSemanticModelIssues`; the editor attributes each one to
   * the model (and metric) row it names.
   */
  issues?: string[];
}

type Column = { name: string; type: string };
type SourceOption = { value: string; label: string; columns: Column[] };

const selectStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'var(--font-jetbrains-mono), monospace',
  padding: '0 6px',
  border: '1px solid var(--chakra-colors-border-muted)',
  borderRadius: '6px',
  background: 'var(--chakra-colors-bg-canvas)',
  color: 'var(--chakra-colors-fg-default)',
  outline: 'none',
  height: '28px',
  cursor: 'pointer',
  minWidth: '120px',
};

const AGGS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT'] as const;
const TEMPORAL_TYPE = /date|time/i;

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

/** Tables + views of one connection, as source-picker options. */
function sourceOptionsFor(connection: string, databases: DatabaseWithSchema[], views: ViewDef[]): SourceOption[] {
  const db = databases.find((d) => d.databaseName === connection);
  const tables: SourceOption[] = (db?.schemas ?? []).flatMap((s) =>
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

function columnsOfSource(source: SemanticSource | undefined, options: SourceOption[]): Column[] {
  return options.find((o) => o.value === encodeSource(source))?.columns ?? [];
}

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
  /** model index → issue details */
  byModel: Map<number, string[]>;
  /** `${modelIndex}:${metricIndex}` → issue details */
  byMetric: Map<string, string[]>;
  /** issues naming a model that isn't on screen (another version, or renamed) */
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
      ? (models[modelIndex].metrics ?? []).findIndex((mt) => mt.name === metricName)
      : -1;
    if (metricIndex >= 0) push(attributed.byMetric, `${modelIndex}:${metricIndex}`, detail);
    else push(attributed.byModel, modelIndex, detail);
  }
  return attributed;
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function ColumnSelect({ label, columns, value, onChange, emptyLabel = 'Select column…' }: {
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
      <option value="">Select source…</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {value && !options.some((o) => o.value === value) && <option value={value}>{value}</option>}
    </select>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.02em">
      {children}
    </Text>
  );
}

function AddRowButton({ label, text, onClick }: { label: string; text: string; onClick: () => void }) {
  return (
    <Box>
      <Button aria-label={label} size="2xs" variant="ghost" onClick={onClick}>
        <LuPlus /> {text}
      </Button>
    </Box>
  );
}

function DeleteRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Box as="button" aria-label={label} onClick={onClick} color="fg.subtle" cursor="pointer"
      _hover={{ color: 'accent.danger' }} flexShrink={0}>
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
          <Box pt="2px" flexShrink={0}><Icon as={LuTriangleAlert} boxSize={3} color="accent.danger" /></Box>
          <Text fontSize="xs" fontFamily="mono" color="accent.danger" whiteSpace="pre-wrap">{text}</Text>
        </HStack>
      ))}
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

export default function SemanticModelsEditor({
  models, inheritedModels = [], databases, views, editMode, onChange, issues = [],
}: SemanticModelsEditorProps) {
  const [browseMode, setBrowseMode] = useState<'edit' | 'catalog'>('edit');
  const mode = editMode ? browseMode : 'catalog';
  const attributed = useMemo(() => attributeIssues(issues, models), [issues, models]);

  const patchModel = (i: number, changes: Partial<SemanticModelV2>) =>
    onChange(models.map((m, idx) => (idx === i ? { ...m, ...changes } : m)));

  const addModel = () => {
    const existing = new Set([...models, ...inheritedModels].map((m) => m.name));
    let name = 'new_model';
    let suffix = 2;
    while (existing.has(name)) name = `new_model_${suffix++}`;
    onChange([...models, {
      name,
      connection: databases[0]?.databaseName ?? '',
      primary: { kind: 'table', table: '' },
      dimensions: [],
      measures: [],
    }]);
  };

  const renderModel = (m: SemanticModelV2, i: number) => {
    const options = sourceOptionsFor(m.connection, databases, views);
    const primaryColumns = columnsOfSource(m.primary, options);
    const refs = m.references ?? [];
    const aliasColumns = (source: string): Column[] =>
      source === 'primary'
        ? primaryColumns
        : columnsOfSource(refs.find((r) => r.alias === source)?.source, options);
    const hasM2M = refs.some((r) => r.relationship === 'many_to_many');
    const modelIssues = attributed.byModel.get(i) ?? [];
    const metricIssues = (j: number) => attributed.byMetric.get(`${i}:${j}`) ?? [];
    const temporalColumns = primaryColumns.filter((c) => TEMPORAL_TYPE.test(c.type));
    const measureNames = m.measures.map((ms) => ms.name);

    const patchRef = (j: number, next: SemanticReference) =>
      patchModel(i, { references: refs.map((r, k) => (k === j ? next : r)) });
    const patchMetric = (j: number, next: SemanticMetricV2) =>
      patchModel(i, { metrics: (m.metrics ?? []).map((mt, k) => (k === j ? next : mt)) });

    return (
      <Box key={i} border="1px solid" borderColor="border.default" borderRadius="md" bg="bg.surface" overflow="hidden">
        {/* Header: name / description / connection / primary */}
        <VStack align="stretch" gap={2} p={3} bg="bg.muted" borderBottom="1px solid" borderColor="border.default">
          <HStack gap={2}>
            <Icon as={LuBoxes} boxSize={4} color="accent.teal" flexShrink={0} />
            <Input aria-label={`semantic-model-${i}-name`} size="sm" fontFamily="mono" fontWeight="600" maxW="240px"
              value={m.name} onChange={(e) => patchModel(i, { name: e.target.value })} placeholder="model name" />
            <Input aria-label={`semantic-model-${i}-description`} size="sm" flex={1}
              value={m.description ?? ''} placeholder="description"
              onChange={(e) => patchModel(i, { description: e.target.value || undefined })} />
            <DeleteRowButton label={`delete-semantic-model-${m.name}`}
              onClick={() => onChange(models.filter((_, idx) => idx !== i))} />
          </HStack>
          <HStack gap={2} flexWrap="wrap">
            <Text fontSize="xs" color="fg.muted" flexShrink={0}>Primary:</Text>
            <select aria-label={`semantic-model-${i}-connection`} style={selectStyle} value={m.connection}
              onChange={(e) => patchModel(i, {
                connection: e.target.value,
                // sources are connection-scoped — a connection change invalidates them
                primary: { kind: 'table', table: '' },
                references: undefined,
              })}>
              {databases.map((d) => <option key={d.databaseName} value={d.databaseName}>{d.databaseName}</option>)}
              {m.connection && !databases.some((d) => d.databaseName === m.connection) &&
                <option value={m.connection}>{m.connection}</option>}
            </select>
            <SourceSelect label={`semantic-model-${i}-primary-source`} options={options}
              value={encodeSource(m.primary)}
              onChange={(v) => patchModel(i, { primary: decodeSource(v) ?? { kind: 'table', table: '' } })} />
            {primaryColumns.length > 0 && m.dimensions.length === 0 && m.measures.length === 0 && (
              <Button aria-label={`semantic-model-${i}-prefill`} size="xs" variant="outline"
                onClick={() => {
                  // Draft-suggestion engine: derive dims/measures/time axis from
                  // the primary's profiled columns as a starting point.
                  const draft = deriveSemanticModels([{
                    databaseName: m.connection,
                    schemas: [{
                      schema: m.primary.kind === 'table' ? (m.primary.schema ?? '') : VIEWS_SCHEMA,
                      tables: [{
                        table: m.primary.kind === 'table' ? m.primary.table : m.primary.view,
                        columns: primaryColumns,
                      }],
                    }],
                  }])[0];
                  if (draft) {
                    patchModel(i, {
                      dimensions: draft.dimensions,
                      measures: draft.measures,
                      ...(draft.timeDimension ? { timeDimension: draft.timeDimension } : {}),
                    });
                  }
                }}>
                Prefill fields
              </Button>
            )}
            {hasM2M && (
              <HStack gap={1}>
                <Text fontSize="xs" color="fg.muted" flexShrink={0}>Primary key (required for many-to-many):</Text>
                <ColumnSelect label={`semantic-model-${i}-primary-key`} columns={primaryColumns}
                  value={m.primaryKey?.[0] ?? ''}
                  onChange={(v) => patchModel(i, { primaryKey: v ? [v] : undefined })} />
              </HStack>
            )}
          </HStack>
        </VStack>

        <VStack align="stretch" gap={3} p={3}>
          {/* Save-gate issues that name this model but no metric of it. */}
          {modelIssues.length > 0 && (
            <IssueList label={`semantic-model-${i}-issues`} issues={modelIssues} />
          )}

          {/* References */}
          <VStack align="stretch" gap={1}>
            <SectionLabel>References</SectionLabel>
            {refs.map((r, j) => {
              const refColumns = columnsOfSource(r.source, options);
              return (
                <VStack key={j} align="stretch" gap={1.5} p={2} border="1px solid" borderColor="border.muted" borderRadius="md">
                  <HStack gap={2} flexWrap="wrap">
                    <SourceSelect label={`semantic-model-${i}-reference-${j}-source`} options={options}
                      value={encodeSource(r.source)}
                      onChange={(v) => patchRef(j, { ...r, source: decodeSource(v) ?? { kind: 'table', table: '' } })} />
                    <Input aria-label={`semantic-model-${i}-reference-${j}-alias`} size="sm" fontFamily="mono" maxW="140px"
                      value={r.alias} placeholder="alias"
                      onChange={(e) => {
                        // Cascade the rename: dimensions carry the alias in
                        // `source`, so renaming without this leaves them
                        // dangling and the save gate rejects the whole model.
                        const next = e.target.value;
                        patchModel(i, {
                          references: refs.map((x, k) => (k === j ? { ...x, alias: next } : x)),
                          dimensions: m.dimensions.map((d) => (d.source === r.alias ? { ...d, source: next } : d)),
                        });
                      }} />
                    <select aria-label={`semantic-model-${i}-reference-${j}-relationship`} style={selectStyle}
                      value={r.relationship}
                      onChange={(e) => {
                        const rel = e.target.value as 'many_to_one' | 'one_to_one' | 'many_to_many';
                        if (rel === 'many_to_many') {
                          patchRef(j, {
                            source: r.source, alias: r.alias, relationship: rel,
                            through: {
                              source: { kind: 'table', table: '' },
                              primaryOn: [{ primaryColumn: '', bridgeColumn: '' }],
                              referencedOn: [{ bridgeColumn: '', referencedColumn: '' }],
                            },
                          });
                        } else {
                          patchRef(j, {
                            source: r.source, alias: r.alias, relationship: rel,
                            on: r.relationship !== 'many_to_many' ? r.on : [{ primaryColumn: '', referencedColumn: '' }],
                          });
                        }
                      }}>
                      <option value="many_to_one">many-to-one</option>
                      <option value="one_to_one">one-to-one</option>
                      <option value="many_to_many">many-to-many</option>
                    </select>
                    <Box flex={1} />
                    <DeleteRowButton label={`semantic-model-${i}-reference-${j}-delete`}
                      onClick={() => patchModel(i, { references: refs.filter((_, k) => k !== j) })} />
                  </HStack>

                  {r.relationship !== 'many_to_many' ? (
                    <VStack align="stretch" gap={1}>
                      {r.on.map((pair, k) => (
                        <HStack key={k} gap={2}>
                          <ColumnSelect label={`semantic-model-${i}-reference-${j}-on-${k}-primary-column`}
                            columns={primaryColumns} value={pair.primaryColumn}
                            onChange={(v) => patchRef(j, { ...r, on: r.on.map((p, x) => (x === k ? { ...p, primaryColumn: v } : p)) })} />
                          <Text fontSize="xs" color="fg.subtle">=</Text>
                          <ColumnSelect label={`semantic-model-${i}-reference-${j}-on-${k}-referenced-column`}
                            columns={refColumns} value={pair.referencedColumn}
                            onChange={(v) => patchRef(j, { ...r, on: r.on.map((p, x) => (x === k ? { ...p, referencedColumn: v } : p)) })} />
                          {r.on.length > 1 && (
                            <DeleteRowButton label={`semantic-model-${i}-reference-${j}-on-${k}-delete`}
                              onClick={() => patchRef(j, { ...r, on: r.on.filter((_, x) => x !== k) })} />
                          )}
                        </HStack>
                      ))}
                      <AddRowButton label={`semantic-model-${i}-reference-${j}-add-on-pair`} text="Add join columns"
                        onClick={() => patchRef(j, { ...r, on: [...r.on, { primaryColumn: '', referencedColumn: '' }] })} />
                    </VStack>
                  ) : (
                    (() => {
                      const bridgeColumns = columnsOfSource(r.through.source, options);
                      const primaryOn = r.through.primaryOn[0] ?? { primaryColumn: '', bridgeColumn: '' };
                      const referencedOn = r.through.referencedOn[0] ?? { bridgeColumn: '', referencedColumn: '' };
                      return (
                        <VStack align="stretch" gap={1}>
                          <HStack gap={2}>
                            <Text fontSize="xs" color="fg.muted" flexShrink={0}>through bridge</Text>
                            <SourceSelect label={`semantic-model-${i}-reference-${j}-bridge-source`} options={options}
                              value={encodeSource(r.through.source)}
                              onChange={(v) => patchRef(j, { ...r, through: { ...r.through, source: decodeSource(v) ?? { kind: 'table', table: '' } } })} />
                          </HStack>
                          <HStack gap={2}>
                            <Text fontSize="xs" color="fg.muted" flexShrink={0}>primary</Text>
                            <ColumnSelect label={`semantic-model-${i}-reference-${j}-primary-on-primary-column`}
                              columns={primaryColumns} value={primaryOn.primaryColumn}
                              onChange={(v) => patchRef(j, { ...r, through: { ...r.through, primaryOn: [{ ...primaryOn, primaryColumn: v }] } })} />
                            <Text fontSize="xs" color="fg.subtle">=</Text>
                            <ColumnSelect label={`semantic-model-${i}-reference-${j}-primary-on-bridge-column`}
                              columns={bridgeColumns} value={primaryOn.bridgeColumn}
                              onChange={(v) => patchRef(j, { ...r, through: { ...r.through, primaryOn: [{ ...primaryOn, bridgeColumn: v }] } })} />
                            <Text fontSize="xs" color="fg.muted" flexShrink={0}>bridge</Text>
                          </HStack>
                          <HStack gap={2}>
                            <Text fontSize="xs" color="fg.muted" flexShrink={0}>bridge</Text>
                            <ColumnSelect label={`semantic-model-${i}-reference-${j}-referenced-on-bridge-column`}
                              columns={bridgeColumns} value={referencedOn.bridgeColumn}
                              onChange={(v) => patchRef(j, { ...r, through: { ...r.through, referencedOn: [{ ...referencedOn, bridgeColumn: v }] } })} />
                            <Text fontSize="xs" color="fg.subtle">=</Text>
                            <ColumnSelect label={`semantic-model-${i}-reference-${j}-referenced-on-referenced-column`}
                              columns={refColumns} value={referencedOn.referencedColumn}
                              onChange={(v) => patchRef(j, { ...r, through: { ...r.through, referencedOn: [{ ...referencedOn, referencedColumn: v }] } })} />
                            <Text fontSize="xs" color="fg.muted" flexShrink={0}>referenced</Text>
                          </HStack>
                        </VStack>
                      );
                    })()
                  )}
                </VStack>
              );
            })}
            <AddRowButton label={`semantic-model-${i}-add-reference`} text="Add reference"
              onClick={() => patchModel(i, {
                references: [...refs, {
                  source: { kind: 'table', table: '' }, alias: '', relationship: 'many_to_one',
                  on: [{ primaryColumn: '', referencedColumn: '' }],
                }],
              })} />
          </VStack>

          {/* Dimensions */}
          <VStack align="stretch" gap={1}>
            <SectionLabel>Dimensions</SectionLabel>
            {m.dimensions.map((d, j) => (
              <HStack key={j} gap={2} flexWrap="wrap">
                <Input aria-label={`semantic-model-${i}-dimension-${j}-name`} size="sm" maxW="200px"
                  value={d.name} placeholder="dimension name"
                  onChange={(e) => patchModel(i, { dimensions: m.dimensions.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)) })} />
                <select aria-label={`semantic-model-${i}-dimension-${j}-source`} style={selectStyle} value={d.source}
                  onChange={(e) => patchModel(i, { dimensions: m.dimensions.map((x, k) => (k === j ? { ...x, source: e.target.value, column: '' } : x)) })}>
                  <option value="primary">primary</option>
                  {refs.filter((r) => r.alias).map((r) => <option key={r.alias} value={r.alias}>{r.alias}</option>)}
                  {d.source !== 'primary' && !refs.some((r) => r.alias === d.source) && <option value={d.source}>{d.source}</option>}
                </select>
                <ColumnSelect label={`semantic-model-${i}-dimension-${j}-column`} columns={aliasColumns(d.source)}
                  value={d.column}
                  onChange={(v) => patchModel(i, { dimensions: m.dimensions.map((x, k) => (k === j ? { ...x, column: v } : x)) })} />
                <Checkbox aria-label={`semantic-model-${i}-dimension-${j}-temporal`} size="sm"
                  checked={!!d.temporal}
                  onCheckedChange={(e: { checked: boolean | 'indeterminate' }) =>
                    patchModel(i, { dimensions: m.dimensions.map((x, k) => (k === j ? { ...x, temporal: e.checked === true || undefined } : x)) })}>
                  <Text fontSize="xs" color="fg.muted">temporal</Text>
                </Checkbox>
                <DeleteRowButton label={`semantic-model-${i}-dimension-${j}-delete`}
                  onClick={() => patchModel(i, { dimensions: m.dimensions.filter((_, k) => k !== j) })} />
              </HStack>
            ))}
            <AddRowButton label={`semantic-model-${i}-add-dimension`} text="Add dimension"
              onClick={() => patchModel(i, { dimensions: [...m.dimensions, { name: '', source: 'primary', column: '' }] })} />
          </VStack>

          {/* Measures */}
          <VStack align="stretch" gap={1}>
            <SectionLabel>Measures</SectionLabel>
            {m.measures.map((ms, j) => (
              <HStack key={j} gap={2} flexWrap="wrap">
                <Input aria-label={`semantic-model-${i}-measure-${j}-name`} size="sm" maxW="200px"
                  value={ms.name} placeholder="measure name"
                  onChange={(e) => patchModel(i, { measures: m.measures.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)) })} />
                <select aria-label={`semantic-model-${i}-measure-${j}-agg`} style={selectStyle} value={ms.agg}
                  onChange={(e) => patchModel(i, { measures: m.measures.map((x, k) => (k === j ? { ...x, agg: e.target.value as typeof ms.agg } : x)) })}>
                  {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <ColumnSelect label={`semantic-model-${i}-measure-${j}-column`} columns={primaryColumns}
                  value={ms.column ?? ''} emptyLabel="(no column — COUNT(*))"
                  onChange={(v) => patchModel(i, { measures: m.measures.map((x, k) => (k === j ? { ...x, column: v || undefined } : x)) })} />
                <DeleteRowButton label={`semantic-model-${i}-measure-${j}-delete`}
                  onClick={() => patchModel(i, { measures: m.measures.filter((_, k) => k !== j) })} />
              </HStack>
            ))}
            <AddRowButton label={`semantic-model-${i}-add-measure`} text="Add measure"
              onClick={() => patchModel(i, { measures: [...m.measures, { name: '', agg: 'SUM', column: '' }] })} />
          </VStack>

          {/* Metrics */}
          <VStack align="stretch" gap={1}>
            <SectionLabel>Metrics</SectionLabel>
            {(m.metrics ?? []).map((mt, j) => (
              <VStack key={j} align="stretch" gap={1} p={2} border="1px solid" borderColor="border.muted" borderRadius="md">
                <HStack gap={2} flexWrap="wrap">
                  <Input aria-label={`semantic-model-${i}-metric-${j}-name`} size="sm" maxW="200px"
                    value={mt.name} placeholder="metric name"
                    onChange={(e) => patchMetric(j, { ...mt, name: e.target.value })} />
                  <select aria-label={`semantic-model-${i}-metric-${j}-type`} style={selectStyle} value={mt.type}
                    onChange={(e) => patchMetric(j, e.target.value === 'ratio'
                      ? { name: mt.name, type: 'ratio', numerator: '', denominator: '', description: mt.description }
                      : { name: mt.name, type: 'sql', sql: '', description: mt.description })}>
                    <option value="ratio">ratio</option>
                    <option value="sql">sql</option>
                  </select>
                  {mt.type === 'ratio' && (
                    <>
                      <select aria-label={`semantic-model-${i}-metric-${j}-numerator`} style={selectStyle} value={mt.numerator}
                        onChange={(e) => patchMetric(j, { ...mt, numerator: e.target.value })}>
                        <option value="">Numerator…</option>
                        {measureNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <Text fontSize="xs" color="fg.subtle">/</Text>
                      <select aria-label={`semantic-model-${i}-metric-${j}-denominator`} style={selectStyle} value={mt.denominator}
                        onChange={(e) => patchMetric(j, { ...mt, denominator: e.target.value })}>
                        <option value="">Denominator…</option>
                        {measureNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </>
                  )}
                  {mt.verified === false && <UnverifiedBadge label={`semantic-model-${i}-metric-${j}-unverified`} />}
                  <Box flex={1} />
                  <DeleteRowButton label={`semantic-model-${i}-metric-${j}-delete`}
                    onClick={() => patchModel(i, { metrics: (m.metrics ?? []).filter((_, k) => k !== j) })} />
                </HStack>
                {mt.type === 'sql' && (
                  <VStack align="stretch" gap={0.5}>
                    <Textarea aria-label={`semantic-model-${i}-metric-${j}-sql`} fontFamily="mono" fontSize="xs" rows={2}
                      value={mt.sql} placeholder="SUM(primary.amount) - SUM(costs.total)"
                      onChange={(e) => patchMetric(j, { ...mt, sql: e.target.value })} />
                    <Text fontSize="2xs" color="fg.subtle">
                      qualify columns as primary.&lt;col&gt; or &lt;alias&gt;.&lt;col&gt;
                    </Text>
                  </VStack>
                )}
                {/* Tier-2/3 problems for THIS metric, at the row that caused them. */}
                {metricIssues(j).length > 0 && (
                  <IssueList label={`semantic-model-${i}-metric-${j}-issue`} issues={metricIssues(j)} />
                )}
              </VStack>
            ))}
            <AddRowButton label={`semantic-model-${i}-add-metric`} text="Add metric"
              onClick={() => patchModel(i, { metrics: [...(m.metrics ?? []), { name: '', type: 'ratio', numerator: '', denominator: '' }] })} />
          </VStack>

          {/* Time dimension */}
          <VStack align="stretch" gap={1}>
            <SectionLabel>Time dimension</SectionLabel>
            <HStack gap={2} flexWrap="wrap">
              <ColumnSelect label={`semantic-model-${i}-time-dimension-column`}
                columns={temporalColumns.length > 0 ? temporalColumns : primaryColumns}
                value={m.timeDimension?.column ?? ''} emptyLabel="(none)"
                onChange={(v) => patchModel(i, { timeDimension: v ? { ...m.timeDimension, column: v } : undefined })} />
              {m.timeDimension && (
                <>
                  <Input aria-label={`semantic-model-${i}-time-dimension-label`} size="sm" maxW="200px"
                    value={m.timeDimension.label ?? ''} placeholder="label"
                    onChange={(e) => patchModel(i, { timeDimension: { ...m.timeDimension!, label: e.target.value || undefined } })} />
                  <Button aria-label={`semantic-model-${i}-time-dimension-clear`} size="2xs" variant="ghost"
                    onClick={() => patchModel(i, { timeDimension: undefined })}>Clear</Button>
                </>
              )}
            </HStack>
          </VStack>
        </VStack>
      </Box>
    );
  };

  // -------------------------------------------------------------------------
  // Catalog — business names only (no tables, no SQL), grouped by connection.
  // -------------------------------------------------------------------------

  const renderCatalog = () => {
    const all: Array<{ m: SemanticModelV2; inherited: boolean }> = [
      ...models.map((m) => ({ m, inherited: false })),
      ...inheritedModels
        .filter((im) => !models.some((m) => m.name === im.name))
        .map((m) => ({ m, inherited: true })),
    ];
    const connections = Array.from(new Set(all.map(({ m }) => m.connection)));
    if (all.length === 0) {
      return <Text fontSize="sm" color="fg.muted" p={3}>No semantic models defined yet.</Text>;
    }
    return (
      <VStack align="stretch" gap={3}>
        {connections.map((conn) => (
          <Box key={conn} aria-label={`semantic-model-catalog-${conn}`}
            border="1px solid" borderColor="border.default" borderRadius="md" bg="bg.surface" overflow="hidden">
            <Box px={3} py={1.5} bg="bg.muted" borderBottom="1px solid" borderColor="border.default">
              <Text fontSize="sm" fontWeight="700" fontFamily="mono">{conn}</Text>
            </Box>
            <VStack align="stretch" gap={3} p={3}>
              {all.filter(({ m }) => m.connection === conn).map(({ m, inherited }) => (
                <Box key={m.name}>
                  <HStack gap={2} mb={1}>
                    <Icon as={LuBoxes} boxSize={3.5} color="accent.teal" />
                    <Text fontSize="sm" fontWeight="700">{m.name}</Text>
                    {inherited && (
                      <Text fontSize="10px" fontWeight="600" color="accent.teal" fontFamily="mono">inherited</Text>
                    )}
                    {m.description && <Text fontSize="xs" color="fg.muted" truncate>{m.description}</Text>}
                  </HStack>
                  <VStack align="stretch" gap={0.5} pl={5}>
                    {m.dimensions.length > 0 && (
                      <Box>
                        <SectionLabel>Dimensions</SectionLabel>
                        {m.dimensions.map((d) => (
                          <HStack key={d.name} gap={2}>
                            <Text fontSize="xs" fontWeight="500">{d.name}</Text>
                            {d.description && <Text fontSize="xs" color="fg.muted" truncate>{d.description}</Text>}
                          </HStack>
                        ))}
                      </Box>
                    )}
                    {(m.measures.length > 0 || (m.metrics ?? []).length > 0) && (
                      <Box>
                        <SectionLabel>Measures &amp; Metrics</SectionLabel>
                        {m.measures.map((ms) => (
                          <HStack key={ms.name} gap={2}>
                            <Text fontSize="xs" fontWeight="500">{ms.name}</Text>
                            {ms.description && <Text fontSize="xs" color="fg.muted" truncate>{ms.description}</Text>}
                          </HStack>
                        ))}
                        {(m.metrics ?? []).map((mt) => (
                          <HStack key={mt.name} gap={2}>
                            <Text fontSize="xs" fontWeight="500">{mt.name}</Text>
                            {mt.description && <Text fontSize="xs" color="fg.muted" truncate>{mt.description}</Text>}
                            {mt.verified === false && <UnverifiedBadge label={`semantic-model-catalog-${mt.name}-unverified`} />}
                          </HStack>
                        ))}
                      </Box>
                    )}
                  </VStack>
                </Box>
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>
    );
  };

  return (
    <VStack align="stretch" gap={3}>
      <HStack justify="space-between">
        <Text fontSize="sm" fontWeight="700" fontFamily="mono">Semantic Models</Text>
        {editMode && (
          <HStack gap={2}>
            <Button aria-label="semantic-model-catalog-toggle" size="xs" variant="outline"
              onClick={() => setBrowseMode(browseMode === 'edit' ? 'catalog' : 'edit')}>
              {browseMode === 'edit' ? 'Catalog' : 'Edit'}
            </Button>
            {mode === 'edit' && (
              <Button aria-label="add-semantic-model" size="xs" variant="outline" onClick={addModel}>
                <LuPlus /> New Semantic Model
              </Button>
            )}
          </HStack>
        )}
      </HStack>
      {/* Issues we could not pin to a row on screen (a model of another
          version, or one renamed since the failed save) — never dropped. */}
      {attributed.unattributed.length > 0 && (
        <IssueList label="semantic-model-unattributed-issues" issues={attributed.unattributed} />
      )}
      {mode === 'edit' ? (
        <VStack align="stretch" gap={3}>
          {models.length === 0 && (
            <Text fontSize="sm" color="fg.muted">No semantic models defined yet. Add one to expose curated dimensions and metrics.</Text>
          )}
          {models.map(renderModel)}
        </VStack>
      ) : renderCatalog()}
    </VStack>
  );
}
