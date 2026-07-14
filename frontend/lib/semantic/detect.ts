/**
 * Semantic query DETECTION — the reverse of compile.ts.
 *
 * Given a SQL query (or its parsed QueryIR) and the semantic models available
 * for a connection, recover the SemanticQuerySpec it corresponds to — or null
 * when it doesn't correspond to one.
 *
 * Everything happens in IR land; SQL only crosses the boundary through the
 * dialect-aware `sqlToIr`/`irToSql` pair in lib/sql. Detection therefore has
 * NO dialect knowledge of its own.
 *
 * Reliability guarantee: a recovered spec is only returned after the
 * RECOMPILE-AND-COMPARE check — `compileSemanticQuery(spec, model)` must
 * reproduce an IR equivalent to the input. Detection can produce false
 * negatives (a semantic-shaped query written oddly), never false positives.
 */

import type { AnyQueryIR, QueryIR, FilterCondition, FilterGroup } from '@/lib/sql/ir-types';
import type { SemanticModel } from '@/lib/types/semantic';
import type { SemanticQuerySpec, SemanticQueryFilter } from '@/lib/validation/atlas-schemas';
import { parseSqlToIrLocal } from '@/lib/sql/sql-to-ir';
import { compileSemanticQuery } from './compile';

/** Recover a spec from an already-parsed IR, or null when it doesn't map. */
export function semanticSpecFromIr(ir: AnyQueryIR, models: SemanticModel[]): SemanticQuerySpec | null {
  if (ir.type === 'compound') return null;
  for (const model of models) {
    const spec = matchModel(ir, model);
    if (spec) return spec;
  }
  return null;
}

/**
 * Detect whether a SQL string is expressible as a semantic query against the
 * given models. Parses with the connection's dialect; returns null on any
 * parse failure or mapping failure.
 */
export async function detectSemanticQuery(
  sql: string,
  models: SemanticModel[],
  dialect: string,
): Promise<SemanticQuerySpec | null> {
  if (!sql.trim() || models.length === 0) return null;
  let ir: AnyQueryIR;
  try {
    ir = await parseSqlToIrLocal(sql, dialect);
  } catch {
    return null;
  }
  return semanticSpecFromIr(ir, models);
}

// ---------------------------------------------------------------------------
// Matching (one model)
// ---------------------------------------------------------------------------

const isFilterGroup = (c: FilterCondition | FilterGroup): c is FilterGroup =>
  'conditions' in c && Array.isArray((c as FilterGroup).conditions);

function matchModel(ir: QueryIR, model: SemanticModel): SemanticQuerySpec | null {
  // Base table must match (schema too when the model declares one).
  if (ir.from.table !== model.table) return null;
  if ((model.schema ?? '') !== (ir.from.schema ?? '')) return null;
  if (ir.ctes?.length || ir.having?.conditions?.length || ir.distinct) return null;

  // Joins: every IR join must be one of the model's declared lookups.
  const aliasByJoin = new Map<string, string>(); // IR table/alias name → model join alias
  for (const join of ir.joins ?? []) {
    const modelJoin = (model.joins ?? []).find((mj) =>
      mj.table === join.table.table &&
      (mj.schema ?? '') === (join.table.schema ?? '') &&
      (join.type === (mj.type ?? 'LEFT')) &&
      join.on?.length === 1 &&
      join.on[0].left_column === mj.leftColumn &&
      join.on[0].right_column === mj.rightColumn,
    );
    if (!modelJoin || join.raw_on_sql) return null;
    aliasByJoin.set(join.table.alias ?? join.table.table, modelJoin.alias);
  }

  // Resolve an IR column reference to a model dimension.
  const findDimension = (column: string | undefined, table: string | undefined) => {
    if (!column) return undefined;
    return model.dimensions.find((d) => {
      if (d.column !== column) return false;
      if (d.join) {
        return !!table && aliasByJoin.get(table) === d.join;
      }
      // Base-table dimension: unqualified, or qualified with the base table name.
      return !table || table === model.table || table === ir.from.alias;
    });
  };

  // --- SELECT list → dimensions / time / measures ---------------------------
  const dimensions: string[] = [];
  const measures: string[] = [];
  let timeGrain: SemanticQuerySpec['timeGrain'];

  for (const col of ir.select) {
    if (col.type === 'column' && col.column && col.column !== '*') {
      const dim = findDimension(col.column, col.table);
      if (!dim) return null;
      dimensions.push(dim.name);
    } else if (col.type === 'expression' && col.function === 'DATE_TRUNC') {
      if (!model.timeDimension || col.column !== model.timeDimension.column || !col.unit) return null;
      if (timeGrain) return null; // one time dimension max
      timeGrain = col.unit as SemanticQuerySpec['timeGrain'];
    } else if (col.type === 'aggregate' && col.aggregate) {
      const measure = model.measures.find((m) =>
        m.agg === col.aggregate && (m.column ?? null) === (col.column ?? null) && !col.wrapper_function,
      );
      if (!measure) return null;
      measures.push(measure.name);
    } else if (col.type === 'raw' && col.raw_sql) {
      // Ratio metrics compile to a fixed raw shape — match by regenerating it.
      const metric = (model.metrics ?? []).find((mt) => {
        const num = model.measures.find((m) => m.name === mt.numerator);
        const den = model.measures.find((m) => m.name === mt.denominator);
        if (!num || !den) return false;
        const aggSql = (m: typeof num) =>
          m.agg === 'COUNT' && !m.column ? 'COUNT(*)'
            : m.agg === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${m.column})`
            : `${m.agg}(${m.column})`;
        return normalizeRaw(col.raw_sql!) === normalizeRaw(`${aggSql(num)} * 1.0 / NULLIF(${aggSql(den)}, 0)`);
      });
      if (!metric) return null;
      measures.push(metric.name);
    } else {
      return null;
    }
  }
  if (measures.length === 0) return null;

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
    measures,
    dimensions,
    ...(timeGrain ? { timeGrain } : {}),
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
 * map through `aliasMap` (the SQL's own alias → the model's join alias, which
 * is what the compiler emits); base-table qualifiers (any spelling: absent,
 * the table name, or the FROM alias) normalize to ''.
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
 * aliases map through `aliasMap`; the recompiled IR already uses model
 * aliases (identity in the map). ORDER BY and LIMIT are deliberately compared
 * loosely: the compiler adds a deterministic ORDER BY the source SQL may not
 * have — accepting that difference means "opening in Semantic mode" may
 * normalize row order, which is the documented behavior.
 */
function irEquivalent(a: QueryIR, b: QueryIR, model: SemanticModel, aliasMap: AliasMap): boolean {
  // The recompiled IR (b) qualifies with the model's own join aliases — map identically.
  const identity: AliasMap = new Map((model.joins ?? []).map((j) => [j.alias, j.alias]));
  if (a.from.table !== b.from.table || (a.from.schema ?? '') !== (b.from.schema ?? '')) return false;
  if (JSON.stringify(canonicalSelect(a, aliasMap)) !== JSON.stringify(canonicalSelect(b, identity))) return false;
  if (JSON.stringify(canonicalGroup(a, aliasMap)) !== JSON.stringify(canonicalGroup(b, identity))) return false;
  if (JSON.stringify(canonicalJoins(a)) !== JSON.stringify(canonicalJoins(b))) return false;
  if (JSON.stringify(canonicalFilters(a, aliasMap)) !== JSON.stringify(canonicalFilters(b, identity))) return false;
  return true;
}
