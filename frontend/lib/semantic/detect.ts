/**
 * Semantic query DETECTION — the reverse of compile.ts.
 *
 * Given a parsed QueryIR and the semantic models available
 * for a connection, recover the SemanticQuerySpec it corresponds to — or null
 * when it doesn't correspond to one.
 *
 * Everything happens in IR land; SQL only crosses the boundary through the
 * dialect-aware `sqlToIr`/`irToSql` pair in lib/sql. Detection therefore has
 * NO dialect knowledge of its own. This module is PURE (no WASM import) so it
 * is safe in client bundles — SQL-string detection lives in detect-sql.ts,
 * which pulls in the WASM parser and must stay server/test-only.
 *
 * Reliability guarantee: a recovered spec is only returned after the
 * RECOMPILE-AND-COMPARE check — `compileSemanticQuery(spec, model)` must
 * reproduce an IR equivalent to the input. Detection can produce false
 * negatives (a semantic-shaped query written oddly), never false positives.
 */

import type { AnyQueryIR, QueryIR, FilterCondition, FilterGroup } from '@/lib/sql/ir-types';
import type { SemanticModelV2, SemanticReference, SemanticReferenceToOne, SemanticSource } from '@/lib/types/semantic';
import type { SemanticQuerySpec, SemanticQueryFilter } from '@/lib/validation/atlas-schemas';
import { VIEWS_SCHEMA } from '@/lib/types/views';
import { aggSql, compileSemanticQuery } from './compile';

/** Recover a spec from an already-parsed IR, or null when it doesn't map. */
export function semanticSpecFromIr(ir: AnyQueryIR, models: SemanticModelV2[]): SemanticQuerySpec | null {
  if (ir.type === 'compound') return null;
  for (const model of models) {
    const spec = matchModel(ir, model);
    if (spec) return spec;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Matching (one model)
// ---------------------------------------------------------------------------

const isFilterGroup = (c: FilterCondition | FilterGroup): c is FilterGroup =>
  'conditions' in c && Array.isArray((c as FilterGroup).conditions);

/** Only to-one references are joinable lookups; m2m compiles through a bridge
 *  (M3) and can never match a plain IR join — skip it for detection. */
const isToOne = (r: SemanticReference): r is SemanticReferenceToOne => r.relationship !== 'many_to_many';

/** The name a source is addressed by in SQL (mirrors compile.ts). */
const sourceTableName = (s: SemanticSource): string => (s.kind === 'table' ? s.table : s.view);

/** The IR table reference for a source (views live under `_views`). */
const sourceTableRef = (s: SemanticSource): { table: string; schema?: string } =>
  s.kind === 'table'
    ? { table: s.table, ...(s.schema ? { schema: s.schema } : {}) }
    : { table: s.view, schema: VIEWS_SCHEMA };

function matchModel(ir: QueryIR, model: SemanticModelV2): SemanticQuerySpec | null {
  // Base table must match (schema too when the primary source declares one;
  // a view primary is addressed as `_views.<view>`).
  const primary = sourceTableRef(model.primary);
  const primaryName = sourceTableName(model.primary);
  if (ir.from.table !== primary.table) return null;
  if ((primary.schema ?? '') !== (ir.from.schema ?? '')) return null;
  if (ir.ctes?.length || ir.having?.conditions?.length || ir.distinct) return null;

  // Joins: every IR join must be one of the model's declared to-one references.
  const toOneRefs = (model.references ?? []).filter(isToOne);
  const aliasByJoin = new Map<string, string>(); // IR table/alias name → model reference alias
  for (const join of ir.joins ?? []) {
    const modelRef = toOneRefs.find((r) => {
      const src = sourceTableRef(r.source);
      return src.table === join.table.table &&
        (src.schema ?? '') === (join.table.schema ?? '') &&
        (join.type === (r.joinType ?? 'LEFT')) &&
        join.on?.length === r.on.length &&
        r.on.every((o, i) =>
          join.on![i].left_column === o.primaryColumn &&
          join.on![i].right_column === o.referencedColumn);
    });
    if (!modelRef || join.raw_on_sql) return null;
    aliasByJoin.set(join.table.alias ?? join.table.table, modelRef.alias);
  }

  // Resolve an IR column reference to a model dimension.
  const findDimension = (column: string | undefined, table: string | undefined) => {
    if (!column) return undefined;
    return model.dimensions.find((d) => {
      if (d.column !== column) return false;
      if (d.source !== 'primary') {
        return !!table && aliasByJoin.get(table) === d.source;
      }
      // Primary-source dimension: unqualified, or qualified with the base name.
      return !table || table === primaryName || table === ir.from.alias;
    });
  };

  // --- SELECT list → dimensions / time / metrics ----------------------------
  const dimensions: string[] = [];
  const metrics: string[] = [];
  let timeGrain: SemanticQuerySpec['timeGrain'];
  let timeColumn: string | undefined;

  for (const col of ir.select) {
    if (col.type === 'column' && col.column && col.column !== '*') {
      const dim = findDimension(col.column, col.table);
      if (!dim) return null;
      dimensions.push(dim.name);
    } else if (col.type === 'expression' && col.function === 'DATE_TRUNC') {
      // Any PRIMARY temporal dimension can be the time axis (spec.timeColumn);
      // the FIRST one is the model's default and needs no timeColumn.
      const temporalDims = model.dimensions.filter((d) => d.temporal && d.source === 'primary');
      const isDefault = temporalDims.length > 0 && col.column === temporalDims[0].column;
      const isTemporalDim = !!col.column && temporalDims.some((d) => d.column === col.column);
      if (!isTemporalDim || !col.unit) return null;
      if (col.table && col.table !== primaryName && col.table !== ir.from.alias) return null;
      if (timeGrain) return null; // one time axis max
      timeGrain = col.unit as SemanticQuerySpec['timeGrain'];
      if (!isDefault) timeColumn = col.column!;
    } else if (col.type === 'aggregate' && col.aggregate) {
      const aggMetric = model.metrics.find((m) =>
        m.type === 'aggregation' && m.agg === col.aggregate && (m.column ?? null) === (col.column ?? null) && !col.wrapper_function,
      );
      if (!aggMetric) return null;
      metrics.push(aggMetric.name);
    } else if (col.type === 'raw' && col.raw_sql) {
      // Ratio metrics compile to a fixed raw shape — match by regenerating it.
      // The compiler qualifies columns with the base name when the query has
      // joins, so accept BOTH the qualified and unqualified renderings.
      const metric = model.metrics.find((mt) => {
        if (mt.type !== 'ratio') return false;
        const num = model.metrics.find((m) => m.type === 'aggregation' && m.name === mt.numerator);
        const den = model.metrics.find((m) => m.type === 'aggregation' && m.name === mt.denominator);
        if (num?.type !== 'aggregation' || den?.type !== 'aggregation') return false;
        const got = normalizeRaw(col.raw_sql!);
        return [undefined, primaryName].some((qual) =>
          got === normalizeRaw(`${aggSql(num, qual)} * 1.0 / NULLIF(${aggSql(den, qual)}, 0)`));
      });
      if (!metric) return null;
      metrics.push(metric.name);
    } else {
      return null;
    }
  }
  if (metrics.length === 0) return null;

  // --- WHERE → dimension filters (flat AND only) -----------------------------
  const filters: SemanticQueryFilter[] = [];
  if (ir.where) {
    if (ir.where.operator !== 'AND') return null;
    for (const cond of ir.where.conditions) {
      if (isFilterGroup(cond)) return null;
      if (cond.aggregate || cond.function || cond.raw_column || cond.raw_value !== undefined || cond.param_name !== undefined) return null;
      const dim = findDimension(cond.column ?? undefined, cond.table);
      if (!dim) return null;
      filters.push({
        dimension: dim.name,
        operator: cond.operator,
        ...(cond.value !== undefined ? { value: cond.value as SemanticQueryFilter['value'] } : {}),
      });
    }
  }

  const spec: SemanticQuerySpec = {
    model: model.name,
    // Scope hints so the client can re-fetch this model on demand later.
    table: primary.table,
    ...(primary.schema ? { schema: primary.schema } : {}),
    metrics,
    dimensions,
    ...(timeGrain ? { timeGrain } : {}),
    ...(timeColumn ? { timeColumn } : {}),
    ...(filters.length > 0 ? { filters } : {}),
    ...(ir.limit !== undefined && ir.limit !== 1000 ? { limit: ir.limit } : {}),
  };

  // --- Reliability gate: recompiling the spec must reproduce this IR --------
  try {
    const recompiled = compileSemanticQuery(spec, model);
    if (!irEquivalent(ir, recompiled, model, aliasByJoin)) return null;
  } catch {
    return null;
  }
  return spec;
}

// ---------------------------------------------------------------------------
// IR equivalence (semantic, order-insensitive where SQL is order-insensitive)
// ---------------------------------------------------------------------------

const normalizeRaw = (sql: string) => sql.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Normalize a column's table qualifier for comparison: joined-table qualifiers
 * map through `aliasMap` (the SQL's own alias → the model's reference alias,
 * which is what the compiler emits); base-table qualifiers (any spelling:
 * absent, the table name, or the FROM alias) normalize to ''.
 */
type AliasMap = Map<string, string>;
const qualify = (table: string | undefined, ir: QueryIR, aliasMap: AliasMap): string => {
  if (!table || table === ir.from.table || table === ir.from.alias) return '';
  return aliasMap.get(table) ?? table;
};

/** Canonical form of a select entry for comparison (output aliases ignored —
 *  SQL is free to name columns anything). */
function canonicalSelect(ir: QueryIR, aliasMap: AliasMap): string[] {
  return ir.select
    .map((c) => {
      if (c.type === 'column') return `col:${qualify(c.table, ir, aliasMap)}.${c.column}`;
      if (c.type === 'expression') return `expr:${c.function}:${c.unit ?? ''}:${c.column}`;
      if (c.type === 'aggregate') return `agg:${c.aggregate}:${c.column ?? ''}`;
      return `raw:${normalizeRaw(c.raw_sql ?? '')}`;
    })
    .sort();
}

function canonicalGroup(ir: QueryIR, aliasMap: AliasMap): string[] {
  return (ir.group_by?.columns ?? [])
    .map((g) => (g.function ? `expr:${g.function}:${g.unit ?? ''}:${g.column}` : `col:${qualify(g.table, ir, aliasMap)}.${g.column}`))
    .sort();
}

function canonicalFilters(ir: QueryIR, aliasMap: AliasMap): string[] {
  if (!ir.where) return [];
  return ir.where.conditions
    .filter((c): c is FilterCondition => !isFilterGroup(c))
    .map((c) => `${qualify(c.table, ir, aliasMap)}.${c.column}:${c.operator}:${JSON.stringify(c.value ?? null)}`)
    .sort();
}

/** Joins compare by table + ON columns; the alias itself is presentation. */
function canonicalJoins(ir: QueryIR): string[] {
  return (ir.joins ?? [])
    .map((j) => `${j.type}:${j.table.schema ?? ''}.${j.table.table}:${j.on?.map((o) => `${o.left_column}=${o.right_column}`).join(',')}`)
    .sort();
}

/**
 * Equivalence for the detection gate, alias-insensitive: the input IR's join
 * aliases map through `aliasMap`; the recompiled IR already uses the model's
 * reference aliases (identity in the map). ORDER BY and LIMIT are deliberately
 * compared loosely: the compiler adds a deterministic ORDER BY the source SQL
 * may not have — accepting that difference means "opening in Semantic mode"
 * may normalize row order, which is the documented behavior.
 */
function irEquivalent(a: QueryIR, b: QueryIR, model: SemanticModelV2, aliasMap: AliasMap): boolean {
  // The recompiled IR (b) qualifies with the model's own reference aliases — map identically.
  const identity: AliasMap = new Map((model.references ?? []).map((r) => [r.alias, r.alias]));
  if (a.from.table !== b.from.table || (a.from.schema ?? '') !== (b.from.schema ?? '')) return false;
  if (JSON.stringify(canonicalSelect(a, aliasMap)) !== JSON.stringify(canonicalSelect(b, identity))) return false;
  if (JSON.stringify(canonicalGroup(a, aliasMap)) !== JSON.stringify(canonicalGroup(b, identity))) return false;
  if (JSON.stringify(canonicalJoins(a)) !== JSON.stringify(canonicalJoins(b))) return false;
  if (JSON.stringify(canonicalFilters(a, aliasMap)) !== JSON.stringify(canonicalFilters(b, identity))) return false;
  return true;
}
