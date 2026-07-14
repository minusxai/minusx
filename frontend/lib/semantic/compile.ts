/**
 * Semantic query compiler — deterministically compiles a SemanticQuerySpec
 * (measures + dimensions + optional time grain + filters) against a
 * SemanticModel into the shared QueryIR, which `irToSqlLocal` then turns into
 * dialect SQL. This is the whole "engine" of the Semantic tier: no SQL is
 * generated here, only IR.
 *
 * Compilation rules:
 *  - measures resolve to aggregate select columns (alias = slug of the name);
 *    ratio metrics compile to a raw `num * 1.0 / NULLIF(den, 0)` expression
 *  - dimensions resolve to plain columns (table-qualified when they live on a
 *    joined table); each referenced join contributes one LEFT/INNER JoinClause
 *  - `timeGrain` uses the model's timeDimension as DATE_TRUNC(grain, column)
 *  - GROUP BY mirrors dimensions + time; filters become a flat AND WHERE
 *  - ORDER BY: time ascending when present, else first measure descending
 *  - limit defaults to 1000
 */

import type { QueryIR, SelectColumn, GroupByItem, FilterCondition, JoinClause, OrderByClause } from '@/lib/sql/ir-types';
import type { SemanticModel, SemanticMeasure, SemanticDimension, SemanticRatioMetric } from '@/lib/types/semantic';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

export class SemanticCompileError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join('; '));
    this.name = 'SemanticCompileError';
    this.issues = issues;
  }
}

/** SQL-safe alias for a business name ("Active Buyers" → "active_buyers"). */
export function semanticAlias(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'field';
}

type Measurable =
  | { kind: 'measure'; measure: SemanticMeasure }
  | { kind: 'metric'; metric: SemanticRatioMetric };

function findMeasurable(model: SemanticModel, name: string): Measurable | null {
  const measure = model.measures.find((m) => m.name === name);
  if (measure) return { kind: 'measure', measure };
  const metric = model.metrics?.find((m) => m.name === name);
  if (metric) return { kind: 'metric', metric };
  return null;
}

const findDimension = (model: SemanticModel, name: string): SemanticDimension | undefined =>
  model.dimensions.find((d) => d.name === name);

/** Validate a spec against its model; returns human-readable issues (empty = valid). */
export function validateSemanticQuery(spec: SemanticQuerySpec, model: SemanticModel): string[] {
  const issues: string[] = [];

  if (spec.measures.length === 0) {
    issues.push('at least one measure is required');
  }
  for (const name of spec.measures) {
    const found = findMeasurable(model, name);
    if (!found) {
      issues.push(`unknown measure "${name}"`);
    } else if (found.kind === 'metric') {
      for (const ref of [found.metric.numerator, found.metric.denominator]) {
        if (!model.measures.some((m) => m.name === ref)) {
          issues.push(`metric "${name}" references unknown measure "${ref}"`);
        }
      }
    }
  }
  for (const name of spec.dimensions) {
    if (!findDimension(model, name)) issues.push(`unknown dimension "${name}"`);
  }
  for (const f of spec.filters ?? []) {
    if (!findDimension(model, f.dimension)) issues.push(`unknown filter dimension "${f.dimension}"`);
  }
  for (const d of [...spec.dimensions, ...(spec.filters ?? []).map((f) => f.dimension)]) {
    const dim = findDimension(model, d);
    if (dim?.join && !model.joins?.some((j) => j.alias === dim.join)) {
      issues.push(`dimension "${d}" references unknown join "${dim.join}"`);
    }
  }
  if (spec.timeGrain && !resolveTimeColumn(spec, model)) {
    issues.push(spec.timeColumn
      ? `"${spec.timeColumn}" is not a temporal column of this model`
      : 'the model has no time dimension configured');
  }

  return issues;
}

/**
 * The time-axis column for a spec: spec.timeColumn when it names a BASE
 * temporal column (any date/time column may be the axis, not just the model's
 * default), else the model's timeDimension.
 */
export function resolveTimeColumn(spec: SemanticQuerySpec, model: SemanticModel): string | undefined {
  if (spec.timeColumn) {
    if (model.timeDimension?.column === spec.timeColumn) return spec.timeColumn;
    const dim = model.dimensions.find((d) => d.column === spec.timeColumn && d.temporal && !d.join);
    return dim ? spec.timeColumn : undefined;
  }
  return model.timeDimension?.column;
}

/**
 * Aggregate SQL fragment for a ratio metric component (base-table columns).
 * `qualifier` prefixes columns with the base table when the query joins —
 * unqualified names are ambiguous the moment another table shares them.
 */
export const aggSql = (m: SemanticMeasure, qualifier?: string): string => {
  const col = qualifier && m.column ? `${qualifier}.${m.column}` : m.column;
  return m.agg === 'COUNT' && !m.column ? 'COUNT(*)'
    : m.agg === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${col})`
    : `${m.agg}(${col})`;
};

/** Compile a valid spec to QueryIR. Throws SemanticCompileError on invalid specs. */
export function compileSemanticQuery(spec: SemanticQuerySpec, model: SemanticModel): QueryIR {
  const issues = validateSemanticQuery(spec, model);
  if (issues.length > 0) throw new SemanticCompileError(issues);

  const select: SelectColumn[] = [];
  const groupColumns: GroupByItem[] = [];

  // Pre-pass: which joins does this query actually use? Once ANY join is in
  // play, every base-table column MUST be qualified — an unqualified name is
  // ambiguous the moment the joined table shares it (campaign_id, created_at,
  // id are all common on both sides of an FK).
  const usedJoins = new Set<string>();
  for (const name of [...spec.dimensions, ...(spec.filters ?? []).map((f) => f.dimension)]) {
    const dim = findDimension(model, name);
    if (dim?.join) usedJoins.add(dim.join);
  }
  const baseQual = usedJoins.size > 0 ? model.table : undefined;

  const resolveDimension = (name: string): { column: string; table?: string } => {
    const dim = findDimension(model, name)!;
    const table = dim.join ?? baseQual;
    return { column: dim.column, ...(table ? { table } : {}) };
  };

  // Dimensions → plain columns (business name as alias) + GROUP BY entries.
  for (const name of spec.dimensions) {
    const { column, table } = resolveDimension(name);
    select.push({ type: 'column', column, ...(table ? { table } : {}), alias: semanticAlias(name) });
    groupColumns.push({ column, ...(table ? { table } : {}) });
  }

  // Time grain → DATE_TRUNC on the spec's time column (default: the model's
  // timeDimension; any base temporal column is allowed via spec.timeColumn).
  const timeColumn = resolveTimeColumn(spec, model);
  const time = spec.timeGrain && timeColumn
    ? { column: timeColumn, unit: spec.timeGrain }
    : undefined;
  if (time) {
    select.push({
      type: 'expression',
      function: 'DATE_TRUNC',
      unit: time.unit,
      column: time.column,
      ...(baseQual ? { table: baseQual } : {}),
      alias: time.unit.toLowerCase(),
    });
    groupColumns.push({
      type: 'expression', function: 'DATE_TRUNC', unit: time.unit, column: time.column,
      ...(baseQual ? { table: baseQual } : {}),
    });
  }

  // Measures/metrics → aggregates (or NULLIF-guarded raw ratios).
  const measureAliases: string[] = [];
  for (const name of spec.measures) {
    const found = findMeasurable(model, name)!;
    const alias = semanticAlias(name);
    measureAliases.push(alias);
    if (found.kind === 'measure') {
      select.push({
        type: 'aggregate',
        aggregate: found.measure.agg,
        column: found.measure.column ?? null,
        ...(baseQual && found.measure.column ? { table: baseQual } : {}),
        alias,
      });
    } else {
      const num = model.measures.find((m) => m.name === found.metric.numerator)!;
      const den = model.measures.find((m) => m.name === found.metric.denominator)!;
      select.push({
        type: 'raw',
        raw_sql: `${aggSql(num, baseQual)} * 1.0 / NULLIF(${aggSql(den, baseQual)}, 0)`,
        alias,
      });
    }
  }

  // Filters → flat AND conditions (dimension-level, pre-aggregation).
  const conditions: FilterCondition[] = (spec.filters ?? []).map((f) => {
    const { column, table } = resolveDimension(f.dimension);
    return {
      column,
      ...(table ? { table } : {}),
      operator: f.operator,
      ...(f.value != null ? { value: f.value } : {}),
    };
  });

  // Joins: only relationships actually referenced by a dimension/filter.
  const joins: JoinClause[] = (model.joins ?? [])
    .filter((j) => usedJoins.has(j.alias))
    .map((j) => ({
      type: j.type ?? 'LEFT',
      table: { table: j.table, ...(j.schema ? { schema: j.schema } : {}), alias: j.alias },
      on: [{
        left_table: model.table,
        left_column: j.leftColumn,
        right_table: j.alias,
        right_column: j.rightColumn,
      }],
    }));

  // Deterministic ordering: time ascending when present, else first measure desc.
  const orderBy: OrderByClause[] = time
    ? [{ type: 'expression', function: 'DATE_TRUNC', unit: time.unit, column: time.column, ...(baseQual ? { table: baseQual } : {}), direction: 'ASC' }]
    : [{ type: 'column', column: measureAliases[0], direction: 'DESC' }];

  return {
    type: 'simple',
    version: 1,
    select,
    from: { table: model.table, ...(model.schema ? { schema: model.schema } : {}) },
    ...(joins.length > 0 ? { joins } : {}),
    ...(conditions.length > 0 ? { where: { operator: 'AND', conditions } } : {}),
    ...(groupColumns.length > 0 ? { group_by: { columns: groupColumns } } : {}),
    order_by: orderBy,
    limit: spec.limit ?? 1000,
  };
}
