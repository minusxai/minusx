// ============================================================================
// Semantic layer types — curated models defined in a context (versioned,
// inheritable, like MetricDef/TableAnnotation) and consumed by the Semantic
// query tier. The vocabulary intentionally mirrors the open semantic layer
// specs (MetricFlow / Cube / OSI): source table, explicit relationships
// (joins), dimensions, measures, and ratio metrics — so an interchange
// import/export stays a trivial mapping.
// ============================================================================

export type SemanticAggregate = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';

export type SemanticTimeGrain = 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

/**
 * A curated group-by/filter field. `column` lives on the model's base table,
 * unless `join` names a SemanticJoin alias — then it lives on that joined table.
 */
export interface SemanticDimension {
  name: string;
  column: string;
  join?: string;
  description?: string;
}

/**
 * Join cardinality, declared from the BASE table's perspective. Semantic joins
 * are dimension LOOKUPS: each base row must match at most one joined row, so
 * measures (which always aggregate the base table) can never fan out. That is
 * why only many_to_one/one_to_one exist — a *-to-many join would silently
 * inflate every SUM/COUNT; those queries belong in the Full GUI / SQL tiers.
 */
export type SemanticJoinRelationship = 'many_to_one' | 'one_to_one';

/** Explicit equi-join relationship from the base table to another table. */
export interface SemanticJoin {
  table: string;
  schema?: string;
  /** Alias joined table is referenced by (dimension.join points here). */
  alias: string;
  type?: 'LEFT' | 'INNER';
  /** Cardinality from the base table's perspective. Default: many_to_one. */
  relationship?: SemanticJoinRelationship;
  /** Column on the model's base table. */
  leftColumn: string;
  /** Column on the joined table. */
  rightColumn: string;
}

/** An aggregation over a base-table column (`column` omitted for COUNT). */
export interface SemanticMeasure {
  name: string;
  agg: SemanticAggregate;
  column?: string;
  description?: string;
}

/** A metric derived from two measures (numerator / denominator). */
export interface SemanticRatioMetric {
  name: string;
  type: 'ratio';
  numerator: string;
  denominator: string;
  description?: string;
}

/**
 * A semantic model: one base table exposed through business-named dimensions,
 * measures and metrics. Stored on a context version (`semanticModels`),
 * inherited like metrics/annotations.
 */
export interface SemanticModel {
  /** Unique (per context) business name, e.g. "Orders". */
  name: string;
  /** Connection (database) name the model queries. */
  connection: string;
  schema?: string;
  table: string;
  description?: string;
  /** Default time axis for `timeGrain` semantic queries. */
  timeDimension?: { column: string; label?: string };
  dimensions: SemanticDimension[];
  measures: SemanticMeasure[];
  joins?: SemanticJoin[];
  metrics?: SemanticRatioMetric[];
}
