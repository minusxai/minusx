/**
 * Semantic query compiler — deterministically compiles a SemanticQuerySpec
 * (measures + dimensions + optional time grain + filters) against an authored
 * SemanticModelV2 into the shared QueryIR, which `irToSqlLocal` then turns into
 * dialect SQL. This is the whole "engine" of the Semantic tier: no SQL is
 * generated here, only IR.
 *
 * Compilation rules (Semantic_Model_v2.md §2.3/§2.5):
 *  - the FROM comes from `model.primary` — a table (`schema.table`) or a data
 *    model (view), addressed as `_views.<name>`
 *  - measures resolve to aggregate select columns (alias = slug of the name);
 *    ratio metrics compile to a raw `num * 1.0 / NULLIF(den, 0)` expression;
 *    SQL metrics compile to raw select columns after the `primary.` →
 *    base-qualifier rewrite (reference aliases already ARE the join aliases)
 *  - dimensions resolve to plain columns (alias-qualified when they live on a
 *    reference); each used to-one reference contributes one JoinClause. A
 *    reference counts as USED when a selected dimension, filter, or SQL-metric
 *    ref touches it — metric-only joins are included (a metric may aggregate a
 *    reference column no dimension selects)
 *  - `timeGrain` uses the model's timeDimension as DATE_TRUNC(grain, column)
 *  - GROUP BY mirrors dimensions + time; filters become a flat AND WHERE
 *  - ORDER BY: time ascending when present, else first measure descending
 *  - limit defaults to 1000
 *  - many_to_many compiles grain-preservingly: a dedup-bridge CTE for grouped
 *    dimensions, a correlated EXISTS (NOT EXISTS when negated) for filters —
 *    both support composite keys, neither can fan a measure out
 */

import type { QueryIR, SelectColumn, GroupByItem, FilterCondition, JoinClause, OrderByClause, CTE } from '@/lib/sql/ir-types';
import type {
  SemanticModelV2, SemanticMeasureV2, SemanticDimensionV2, SemanticMetricV2,
  SemanticRatioMetricV2, SemanticSqlMetric, SemanticReference, SemanticReferenceToOne,
  SemanticReferenceM2M, SemanticSource,
} from '@/lib/types/semantic';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';
import { VIEWS_SCHEMA } from '@/lib/types/views';
import { lexMetricSql, rewriteMetricSql } from './metric-sql';

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
  | { kind: 'measure'; measure: SemanticMeasureV2 }
  | { kind: 'ratio'; metric: SemanticRatioMetricV2 }
  | { kind: 'sql'; metric: SemanticSqlMetric };

function findMeasurable(model: SemanticModelV2, name: string): Measurable | null {
  const measure = model.measures.find((m) => m.name === name);
  if (measure) return { kind: 'measure', measure };
  const metric = (model.metrics ?? []).find((m) => m.name === name);
  if (metric) return metric.type === 'ratio' ? { kind: 'ratio', metric } : { kind: 'sql', metric };
  return null;
}

const findDimension = (model: SemanticModelV2, name: string): SemanticDimensionV2 | undefined =>
  model.dimensions.find((d) => d.name === name);

const findReference = (model: SemanticModelV2, alias: string): SemanticReference | undefined =>
  (model.references ?? []).find((r) => r.alias === alias);

const isToOne = (r: SemanticReference): r is SemanticReferenceToOne => r.relationship !== 'many_to_many';

/** The name a source is addressed by in SQL (its FROM/qualifier identity). */
const sourceTableName = (s: SemanticSource): string => (s.kind === 'table' ? s.table : s.view);

/** The IR table reference for a source (views live under `_views`). */
const sourceTableRef = (s: SemanticSource): { table: string; schema?: string } =>
  s.kind === 'table'
    ? { table: s.table, ...(s.schema ? { schema: s.schema } : {}) }
    : { table: s.view, schema: VIEWS_SCHEMA };

/** The full SQL spelling of a source (`schema.table` / `_views.view`). */
const sourceSqlName = (s: SemanticSource): string => {
  const ref = sourceTableRef(s);
  return ref.schema ? `${ref.schema}.${ref.table}` : ref.table;
};

/** SQL literal for a semi-join WHERE value (mirrors ir-to-sql's formatValue). */
const formatSqlValue = (value: unknown): string => {
  if (value == null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
};

/** Validate a spec against its model; returns human-readable issues (empty = valid). */
export function validateSemanticQuery(spec: SemanticQuerySpec, model: SemanticModelV2): string[] {
  const issues: string[] = [];

  if (spec.measures.length === 0) {
    issues.push('at least one measure is required');
  }
  for (const name of spec.measures) {
    const found = findMeasurable(model, name);
    if (!found) {
      issues.push(`unknown measure "${name}"`);
    } else if (found.kind === 'ratio') {
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
    if (dim && dim.source !== 'primary' && !findReference(model, dim.source)) {
      issues.push(`dimension "${d}" references unknown reference "${dim.source}"`);
    }
  }
  if (spec.timeGrain && !resolveTimeColumn(spec, model)) {
    issues.push(spec.timeColumn
      ? `"${spec.timeColumn}" is not a temporal column of this model`
      : 'the model has no time dimension configured');
  }

  // m2m rule (§5): GROUP BY dimensions from at most ONE m2m reference — two
  // bridges cross-multiply and re-inflate measures within groups. (Filters from
  // any number of m2m references compose freely; each is its own EXISTS.)
  const m2mAliasOf = (dimName: string): string | undefined => {
    const dim = findDimension(model, dimName);
    if (!dim || dim.source === 'primary') return undefined;
    const ref = findReference(model, dim.source);
    return ref && !isToOne(ref) ? ref.alias : undefined;
  };
  const groupedM2M = new Set(spec.dimensions.map(m2mAliasOf).filter((a): a is string => !!a));
  if (groupedM2M.size > 1) {
    issues.push(`a semantic query may GROUP BY dimensions from at most one m2m reference (got ${[...groupedM2M].join(', ')}) — split into two queries or model a combined bridge view`);
  }

  return issues;
}

/**
 * The time-axis column for a spec: spec.timeColumn when it names a PRIMARY
 * temporal column (any date/time column may be the axis, not just the model's
 * default), else the model's timeDimension.
 */
export function resolveTimeColumn(spec: SemanticQuerySpec, model: SemanticModelV2): string | undefined {
  if (spec.timeColumn) {
    if (model.timeDimension?.column === spec.timeColumn) return spec.timeColumn;
    const dim = model.dimensions.find((d) => d.column === spec.timeColumn && d.temporal && d.source === 'primary');
    return dim ? spec.timeColumn : undefined;
  }
  return model.timeDimension?.column;
}

/**
 * Aggregate SQL fragment for a ratio metric component (primary columns).
 * `qualifier` prefixes columns with the base when the query joins —
 * unqualified names are ambiguous the moment another source shares them.
 */
export const aggSql = (m: SemanticMeasureV2, qualifier?: string): string => {
  const col = qualifier && m.column ? `${qualifier}.${m.column}` : m.column;
  return m.agg === 'COUNT' && !m.column ? 'COUNT(*)'
    : m.agg === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${col})`
    : `${m.agg}(${col})`;
};

/**
 * Which references does this spec actually use? A reference is used when a
 * selected dimension / filter lives on it, OR a SQL metric's qualified refs
 * touch it (metric-only join inclusion — skipping this silently emits invalid
 * SQL for `SUM(costs.total)` with no costs dimension selected).
 */
function collectUsedReferences(spec: SemanticQuerySpec, model: SemanticModelV2): Set<string> {
  const used = new Set<string>();
  for (const name of [...spec.dimensions, ...(spec.filters ?? []).map((f) => f.dimension)]) {
    const dim = findDimension(model, name);
    if (dim && dim.source !== 'primary') used.add(dim.source);
  }
  for (const name of spec.measures) {
    const found = findMeasurable(model, name);
    if (found?.kind === 'sql') {
      for (const ref of lexMetricSql(found.metric.sql, new Map()).refs) {
        if (ref.alias !== 'primary' && findReference(model, ref.alias)) used.add(ref.alias);
      }
    }
  }
  return used;
}

/** Compile a valid spec to QueryIR. Throws SemanticCompileError on invalid specs. */
export function compileSemanticQuery(spec: SemanticQuerySpec, model: SemanticModelV2): QueryIR {
  const issues = validateSemanticQuery(spec, model);
  if (issues.length > 0) throw new SemanticCompileError(issues);

  const usedRefs = collectUsedReferences(spec, model);

  // Partition used m2m references: GROUPED (some selected dimension lives on
  // them → dedup-bridge CTE + LEFT join) vs FILTER-ONLY (→ semi-join; never
  // joined, so it can never fan out). §5.
  const m2mByAlias = new Map<string, SemanticReferenceM2M>();
  for (const alias of usedRefs) {
    const ref = findReference(model, alias);
    if (ref && !isToOne(ref)) m2mByAlias.set(alias, ref);
  }
  const groupedM2M = new Set(
    spec.dimensions
      .map((n) => findDimension(model, n)!)
      .filter((d) => m2mByAlias.has(d.source))
      .map((d) => d.source),
  );

  const select: SelectColumn[] = [];
  const groupColumns: GroupByItem[] = [];

  // Once ANY join is in play, every base column MUST be qualified — an
  // unqualified name is ambiguous the moment a joined source shares it.
  const baseName = sourceTableName(model.primary);
  const baseQual = usedRefs.size > 0 ? baseName : undefined;

  const resolveDimension = (name: string): { column: string; table?: string } => {
    const dim = findDimension(model, name)!;
    const table = dim.source === 'primary' ? baseQual
      : groupedM2M.has(dim.source) ? `_m2m_${dim.source}`
      : dim.source;
    return { column: dim.column, ...(table ? { table } : {}) };
  };

  // Dimensions → plain columns (business name as alias) + GROUP BY entries.
  for (const name of spec.dimensions) {
    const { column, table } = resolveDimension(name);
    select.push({ type: 'column', column, ...(table ? { table } : {}), alias: semanticAlias(name) });
    groupColumns.push({ column, ...(table ? { table } : {}) });
  }

  // Time grain → DATE_TRUNC on the spec's time column (default: the model's
  // timeDimension; any primary temporal column is allowed via spec.timeColumn).
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

  // Measures/metrics → aggregates, NULLIF-guarded raw ratios, or rewritten
  // raw SQL-metric expressions.
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
    } else if (found.kind === 'ratio') {
      const num = model.measures.find((m) => m.name === found.metric.numerator)!;
      const den = model.measures.find((m) => m.name === found.metric.denominator)!;
      select.push({
        type: 'raw',
        raw_sql: `${aggSql(num, baseQual)} * 1.0 / NULLIF(${aggSql(den, baseQual)}, 0)`,
        alias,
      });
    } else {
      // SQL metric: `primary.` → base qualifier; reference aliases already
      // match the compiled join aliases, so they pass through untouched.
      select.push({
        type: 'raw',
        raw_sql: rewriteMetricSql(found.metric.sql, baseName),
        alias,
      });
    }
  }

  // Filters → flat AND conditions. Filters on a FILTER-ONLY m2m alias become
  // semi-joins (`pk IN (bridge lookup)`) — grouped-m2m and ordinary filters
  // stay dimension-level conditions (grouped-m2m ones qualify by the CTE).
  type FarFilter = { column: string; operator: string; value?: unknown };
  const semiJoinFilters = new Map<string, FarFilter[]>();
  const groupedM2MFilters = new Map<string, FarFilter[]>();
  const conditions: FilterCondition[] = [];
  for (const f of spec.filters ?? []) {
    const dim = findDimension(model, f.dimension)!;
    if (m2mByAlias.has(dim.source)) {
      // m2m filters NEVER become outer conditions: a filter-only alias compiles
      // to a semi-join, and a GROUPED alias filters inside its dedup CTE. An
      // outer condition would drag the filter column into the CTE's DISTINCT
      // projection, widening the grain from (pk, groupedCol) to
      // (pk, groupedCol, filterCol) — two far rows sharing the grouped value
      // then double-count one primary row inside its group.
      const target = groupedM2M.has(dim.source) ? groupedM2MFilters : semiJoinFilters;
      const list = target.get(dim.source) ?? [];
      list.push({ column: dim.column, operator: f.operator, value: f.value });
      target.set(dim.source, list);
      continue;
    }
    const { column, table } = resolveDimension(f.dimension);
    conditions.push({
      column,
      ...(table ? { table } : {}),
      operator: f.operator,
      ...(f.value != null ? { value: f.value } : {}),
    });
  }

  /**
   * WHERE fragment over the FAR table of an m2m reference (shared by both
   * forms). NEGATED operators are rendered POSITIVELY here — the negation is
   * carried by `NOT EXISTS` on the outside, because "orders not tagged vip"
   * means "no matching bridge row exists", not "has a tag whose name != vip".
   * `IS NULL`/`IS NOT NULL` mean has-no-related-row / has-one, so they
   * contribute no far-table predicate at all.
   */
  const farWhere = (farName: string, filters: FarFilter[]): string =>
    filters.flatMap((f) => {
      if (f.operator === 'IS NULL' || f.operator === 'IS NOT NULL') return [];
      const lhs = `${farName}.${f.column}`;
      if (f.operator === 'IN') {
        const values = Array.isArray(f.value) ? f.value : [f.value];
        return [`${lhs} IN (${values.map(formatSqlValue).join(', ')})`];
      }
      const op = f.operator === '!=' ? '=' : f.operator; // negation lives on EXISTS
      return [`${lhs} ${op} ${formatSqlValue(f.value)}`];
    }).join(' AND ');

  /** True when the filter set asks for ABSENCE of a matching related row. */
  const isNegated = (filters: FarFilter[]): boolean =>
    filters.some((f) => f.operator === '!=' || f.operator === 'IS NULL');

  // Semi-joins: one `primary.pk IN (SELECT bridge.pk … WHERE …)` per
  // filter-only m2m reference. Independent semi-joins compose (AND).
  for (const [alias, filters] of semiJoinFilters) {
    const ref = m2mByAlias.get(alias)!;
    const bridgeName = sourceTableName(ref.through.source);
    const farName = sourceTableName(ref.source);
    // CORRELATED EXISTS rather than `pk IN (SELECT …)`. Three things fall out
    // of that one choice: composite keys work (one correlation term per key
    // column — an uncorrelated IN can only carry a single column on BigQuery),
    // negation works (`NOT EXISTS`, which is NULL-safe where `NOT IN` is not),
    // and the engine can stop at the first matching bridge row.
    const correlation = ref.through.primaryOn
      .map((p) => `${bridgeName}.${p.bridgeColumn} = ${baseName}.${p.primaryColumn}`);
    const bridgeToFar = ref.through.referencedOn
      .map((r) => `${bridgeName}.${r.bridgeColumn} = ${farName}.${r.referencedColumn}`)
      .join(' AND ');
    const far = farWhere(farName, filters);
    const where = [...correlation, ...(far ? [far] : [])].join(' AND ');
    conditions.push({
      raw_sql: `${isNegated(filters) ? 'NOT EXISTS' : 'EXISTS'} (SELECT 1 FROM ${sourceSqlName(ref.through.source)} JOIN ${sourceSqlName(ref.source)} ON ${bridgeToFar} WHERE ${where})`,
    } as FilterCondition);
  }

  // Joins: to-one references actually used by this query, aliased by the
  // AUTHOR's alias — dimensions/metrics qualify by it.
  const joins: JoinClause[] = (model.references ?? [])
    .filter((r): r is SemanticReferenceToOne => usedRefs.has(r.alias) && isToOne(r))
    .map((r) => ({
      type: r.joinType ?? 'LEFT',
      table: { ...sourceTableRef(r.source), alias: r.alias },
      on: r.on.map((o) => ({
        left_table: baseName,
        left_column: o.primaryColumn,
        right_table: r.alias,
        right_column: o.referencedColumn,
      })),
    }));

  // Grouped m2m → dedup-bridge CTE joined at the primary's grain (§5,
  // execution-verified). The CTE projects ONLY the grouped dimension columns,
  // so DISTINCT yields exactly one row per (pk, dim value) — no within-group
  // double counting, and duplicate bridge rows are absorbed.
  //
  // Filters on the alias live INSIDE the CTE (never as outer conditions): that
  // keeps the projection — and therefore the grain — independent of what is
  // filtered. A filtered alias joins INNER (the filter restricts the primary
  // set, matching semi-join semantics for filter-only m2m); an unfiltered one
  // joins LEFT, keeping unmatched primaries as a NULL group.
  const ctes: CTE[] = [];
  for (const alias of groupedM2M) {
    const ref = m2mByAlias.get(alias)!;
    const bridgeName = sourceTableName(ref.through.source);
    const farName = sourceTableName(ref.source);
    const pOn = ref.through.primaryOn[0];
    const rOn = ref.through.referencedOn[0];
    const cteName = `_m2m_${alias}`;
    const groupedColumns = [...new Set(
      spec.dimensions
        .map((n) => findDimension(model, n)!)
        .filter((d) => d.source === alias)
        .map((d) => d.column),
    )];
    const aliasFilters = groupedM2MFilters.get(alias) ?? [];
    const cteWhere = aliasFilters.length > 0 ? ` WHERE ${farWhere(farName, aliasFilters)}` : '';
    ctes.push({
      name: cteName,
      raw_sql: `SELECT DISTINCT ${bridgeName}.${pOn.bridgeColumn} AS _pk, ${groupedColumns.map((c) => `${farName}.${c} AS ${c}`).join(', ')} FROM ${sourceSqlName(ref.through.source)} JOIN ${sourceSqlName(ref.source)} ON ${bridgeName}.${rOn.bridgeColumn} = ${farName}.${rOn.referencedColumn}${cteWhere}`,
    });
    joins.push({
      type: aliasFilters.length > 0 ? 'INNER' : 'LEFT',
      table: { table: cteName },
      on: [{
        left_table: baseName,
        left_column: pOn.primaryColumn,
        right_table: cteName,
        right_column: '_pk',
      }],
    });
  }

  // Deterministic ordering: time ascending when present, else first measure desc.
  const orderBy: OrderByClause[] = time
    ? [{ type: 'expression', function: 'DATE_TRUNC', unit: time.unit, column: time.column, ...(baseQual ? { table: baseQual } : {}), direction: 'ASC' }]
    : [{ type: 'column', column: measureAliases[0], direction: 'DESC' }];

  return {
    type: 'simple',
    version: 1,
    ...(ctes.length > 0 ? { ctes } : {}),
    select,
    from: sourceTableRef(model.primary),
    ...(joins.length > 0 ? { joins } : {}),
    ...(conditions.length > 0 ? { where: { operator: 'AND', conditions } } : {}),
    ...(groupColumns.length > 0 ? { group_by: { columns: groupColumns } } : {}),
    order_by: orderBy,
    limit: spec.limit ?? 1000,
  };
}

/** All metric kinds a spec may name in `measures` (measure | ratio | sql). */
export type { SemanticMetricV2 };
