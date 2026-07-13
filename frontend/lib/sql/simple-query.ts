/**
 * Simple-tier query model — a strict, Scuba-style subset of QueryIR.
 *
 * The Simple GUI edits a `SimpleQuerySpec` (one table, measures, group-bys, an
 * optional time dimension with grain, flat AND filters, limit). It projects
 * losslessly to/from QueryIR:
 *
 *   - `simpleSpecFromIr(ir)` decides whether an IR *fits* the Simple tier and,
 *     when it does, returns the spec. When it doesn't, it returns the reasons
 *     (used for the Simple tab tooltip — mirrors `useGuiCompat`).
 *   - `irFromSimpleSpec(spec)` builds the canonical QueryIR for a spec (which
 *     `irToSqlLocal` then turns into dialect SQL).
 *
 * Fit rules (everything else falls back to the Full GUI tier):
 *   - single simple SELECT: no compound/CTE/JOIN/HAVING/DISTINCT
 *   - select list is either exactly `*` (raw rows mode, measures: []) or
 *     plain group-by columns + at most one DATE_TRUNC time expression +
 *     aggregate measures (COUNT/SUM/AVG/MIN/MAX/COUNT_DISTINCT)
 *   - GROUP BY exactly mirrors the selected dimensions (columns + time expr)
 *   - WHERE is a flat AND list of plain column/operator/value conditions
 *     (no nesting, no OR, no aggregates, no functions, no :params, no raw SQL)
 *   - ORDER BY only references visible fields (group-bys, measure aliases,
 *     the time dimension) — or any plain column in raw rows mode
 */

import type {
  AnyQueryIR,
  QueryIR,
  SelectColumn,
  TableReference,
  FilterCondition,
  FilterGroup,
  OrderByClause,
} from './ir-types';

/** Aggregations the Simple tier exposes (same set the IR supports). */
export type SimpleAggregate = NonNullable<SelectColumn['aggregate']>;

/** Time grains the Simple tier exposes (same set DATE_TRUNC supports in the IR). */
export type SimpleTimeGrain = NonNullable<SelectColumn['unit']>;

/** One measure: an aggregate over a column (`column: null` = COUNT(*)). */
export interface SimpleMeasure {
  aggregate: SimpleAggregate;
  column: string | null;
  alias?: string;
}

/** The time dimension: DATE_TRUNC(grain, column), optionally aliased. */
export interface SimpleTimeDimension {
  column: string;
  grain: SimpleTimeGrain;
  alias?: string;
}

/** One flat filter: column op value (AND-combined). */
export interface SimpleFilterItem {
  column: string;
  operator: FilterCondition['operator'];
  value?: FilterCondition['value'];
}

/**
 * The Simple tier's full query state. Invariant: when `measures` is empty the
 * query is raw rows mode (`SELECT *`) and `groupBy`/`time` must be empty/unset.
 */
export interface SimpleQuerySpec {
  table: TableReference;
  measures: SimpleMeasure[];
  groupBy: string[];
  time?: SimpleTimeDimension;
  filters: SimpleFilterItem[];
  /** Preserved (not edited) by the Simple UI; restricted to visible fields. */
  orderBy?: OrderByClause[];
  limit?: number;
}

export type SimpleFitResult =
  | { fits: true; spec: SimpleQuerySpec }
  | { fits: false; reasons: string[] };

const isFilterGroup = (c: FilterCondition | FilterGroup): c is FilterGroup =>
  'conditions' in c && Array.isArray((c as FilterGroup).conditions);

/** DATE_TRUNC select entry the Simple tier recognises as the time dimension. */
const isTimeExpression = (c: SelectColumn): boolean =>
  c.type === 'expression' && c.function === 'DATE_TRUNC' && !!c.unit && !!c.column && !c.wrapper_function;

const isPlainAggregate = (c: SelectColumn): boolean =>
  c.type === 'aggregate' && !!c.aggregate && !c.function && !c.wrapper_function;

const isStarColumn = (c: SelectColumn): boolean => c.type === 'column' && c.column === '*';

/** Project an IR onto the Simple tier, or report why it doesn't fit. */
export function simpleSpecFromIr(ir: AnyQueryIR): SimpleFitResult {
  const reasons: string[] = [];

  if (ir.type === 'compound') {
    return { fits: false, reasons: ['UNION / compound queries'] };
  }

  if (ir.ctes?.length) reasons.push('CTEs (WITH clauses)');
  if (ir.joins?.length) reasons.push('joins');
  if (ir.having?.conditions?.length) reasons.push('HAVING conditions');
  if (ir.distinct) reasons.push('DISTINCT');

  // --- SELECT list -> measures / group-by dimensions / time dimension -------
  const measures: SimpleMeasure[] = [];
  const dimensionColumns: string[] = [];
  let time: SimpleTimeDimension | undefined;
  let rawRowsMode = false;

  // Defensive: IRs arriving over the wire may omit `select` on odd inputs.
  const selectList = ir.select ?? [];
  if (selectList.length === 1 && isStarColumn(selectList[0])) {
    rawRowsMode = true;
  } else {
    for (const col of selectList) {
      if (isStarColumn(col)) {
        reasons.push('SELECT * mixed with other columns');
      } else if (col.type === 'column' && col.column && !col.table) {
        dimensionColumns.push(col.column);
      } else if (isPlainAggregate(col)) {
        measures.push({
          aggregate: col.aggregate!,
          column: col.column ?? null,
          ...(col.alias ? { alias: col.alias } : {}),
        });
      } else if (isTimeExpression(col)) {
        if (time) {
          reasons.push('multiple time dimensions');
        } else {
          time = { column: col.column!, grain: col.unit!, ...(col.alias ? { alias: col.alias } : {}) };
        }
      } else {
        reasons.push('complex SELECT expressions (raw SQL, functions, or wrapped aggregates)');
      }
    }
  }

  // --- GROUP BY must exactly mirror the selected dimensions ----------------
  const groupItems = ir.group_by?.columns ?? [];
  if (rawRowsMode && groupItems.length > 0) {
    reasons.push('GROUP BY without aggregate measures');
  }
  if (!rawRowsMode) {
    const hasAggregates = measures.length > 0;
    const hasDimensions = dimensionColumns.length > 0 || !!time;
    if (hasDimensions && !hasAggregates) {
      reasons.push('dimensions without aggregate measures');
    }
    if (hasDimensions && hasAggregates) {
      const expectedColumns = new Set(dimensionColumns);
      const matchedColumns = new Set<string>();
      let timeMatched = false;
      for (const item of groupItems) {
        const isExpr = item.type === 'expression' || !!item.function;
        if (!isExpr && item.column && expectedColumns.has(item.column)) {
          matchedColumns.add(item.column);
        } else if (
          isExpr && item.function === 'DATE_TRUNC' && time &&
          item.column === time.column && item.unit === time.grain
        ) {
          timeMatched = true;
        } else {
          reasons.push('GROUP BY does not mirror the selected dimensions');
        }
      }
      if (matchedColumns.size !== expectedColumns.size || (!!time && !timeMatched)) {
        reasons.push('GROUP BY does not mirror the selected dimensions');
      }
    }
    if (!hasDimensions && groupItems.length > 0) {
      reasons.push('GROUP BY does not mirror the selected dimensions');
    }
  }

  // --- WHERE: flat AND list of plain conditions -----------------------------
  const filters: SimpleFilterItem[] = [];
  if (ir.where) {
    if (ir.where.operator !== 'AND') {
      reasons.push('OR filter groups');
    }
    for (const cond of ir.where.conditions) {
      if (isFilterGroup(cond)) {
        reasons.push('nested filter groups');
        continue;
      }
      if (cond.param_name !== undefined) {
        reasons.push('filters bound to :parameters');
        continue;
      }
      if (cond.aggregate || cond.function || cond.raw_column || cond.raw_value !== undefined || !cond.column) {
        reasons.push('complex filter expressions');
        continue;
      }
      filters.push({
        column: cond.column,
        operator: cond.operator,
        ...(cond.value !== undefined ? { value: cond.value } : {}),
      });
    }
  }

  // --- ORDER BY: only visible fields ---------------------------------------
  const visibleOrderColumns = new Set<string>([
    ...dimensionColumns,
    ...measures.map((m) => m.alias).filter((a): a is string => !!a),
    ...(time ? [time.column, ...(time.alias ? [time.alias] : [])] : []),
  ]);
  const orderBy: OrderByClause[] = [];
  for (const item of ir.order_by ?? []) {
    const isExpr = item.type === 'expression' || (!!item.function && item.type !== 'raw');
    if (item.type === 'raw' || item.raw_sql) {
      reasons.push('complex ORDER BY expressions');
    } else if (isExpr) {
      if (item.function === 'DATE_TRUNC' && time && item.column === time.column && item.unit === time.grain) {
        orderBy.push(item);
      } else {
        reasons.push('ORDER BY references a hidden expression');
      }
    } else if (item.column && (rawRowsMode || visibleOrderColumns.has(item.column))) {
      orderBy.push(item);
    } else {
      reasons.push('ORDER BY references a column not shown in the query');
    }
  }

  if (reasons.length > 0) {
    return { fits: false, reasons: [...new Set(reasons)] };
  }

  return {
    fits: true,
    spec: {
      table: ir.from,
      measures,
      groupBy: dimensionColumns,
      ...(time ? { time } : {}),
      filters,
      ...(orderBy.length > 0 ? { orderBy } : {}),
      ...(ir.limit !== undefined ? { limit: ir.limit } : {}),
    },
  };
}

/**
 * Drop preserved ORDER BY entries whose referent is no longer visible in the
 * spec (used by the Simple UI after removing a measure/dimension/time). In raw
 * rows mode every column is visible, so entries are kept as-is.
 */
export function pruneOrderBy(spec: SimpleQuerySpec): SimpleQuerySpec {
  if (!spec.orderBy?.length) return spec;
  const rawRowsMode = spec.measures.length === 0;
  const visible = new Set<string>([
    ...spec.groupBy,
    ...spec.measures.map((m) => m.alias).filter((a): a is string => !!a),
    ...(spec.time ? [spec.time.column, ...(spec.time.alias ? [spec.time.alias] : [])] : []),
  ]);
  const orderBy = spec.orderBy.filter((item) => {
    if (item.type === 'raw' || item.raw_sql) return false;
    const isExpr = item.type === 'expression' || !!item.function;
    if (isExpr) {
      return item.function === 'DATE_TRUNC' && !!spec.time &&
        item.column === spec.time.column && item.unit === spec.time.grain;
    }
    return !!item.column && (rawRowsMode || visible.has(item.column));
  });
  const { orderBy: _dropped, ...rest } = spec;
  return orderBy.length > 0 ? { ...rest, orderBy } : rest;
}

/** Build the canonical QueryIR for a Simple spec. */
export function irFromSimpleSpec(spec: SimpleQuerySpec): QueryIR {
  const select: SelectColumn[] = [];
  let groupBy: QueryIR['group_by'];

  if (spec.measures.length === 0) {
    select.push({ type: 'column', column: '*' });
  } else {
    for (const col of spec.groupBy) {
      select.push({ type: 'column', column: col });
    }
    if (spec.time) {
      select.push({
        type: 'expression',
        function: 'DATE_TRUNC',
        unit: spec.time.grain,
        column: spec.time.column,
        ...(spec.time.alias ? { alias: spec.time.alias } : {}),
      });
    }
    for (const m of spec.measures) {
      select.push({
        type: 'aggregate',
        aggregate: m.aggregate,
        column: m.column,
        ...(m.alias ? { alias: m.alias } : {}),
      });
    }
    if (spec.groupBy.length > 0 || spec.time) {
      groupBy = {
        columns: [
          ...spec.groupBy.map((column) => ({ column })),
          ...(spec.time
            ? [{ type: 'expression' as const, function: 'DATE_TRUNC' as const, unit: spec.time.grain, column: spec.time.column }]
            : []),
        ],
      };
    }
  }

  const where: FilterGroup | undefined = spec.filters.length > 0
    ? {
        operator: 'AND',
        conditions: spec.filters.map((f) => ({
          column: f.column,
          operator: f.operator,
          ...(f.value !== undefined ? { value: f.value } : {}),
        })),
      }
    : undefined;

  return {
    type: 'simple',
    version: 1,
    select,
    from: spec.table,
    ...(where ? { where } : {}),
    ...(groupBy ? { group_by: groupBy } : {}),
    ...(spec.orderBy?.length ? { order_by: spec.orderBy } : {}),
    ...(spec.limit !== undefined ? { limit: spec.limit } : {}),
  };
}
