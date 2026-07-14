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
  /** Column is date/time-typed — usable as the query's time axis (timeColumn). */
  temporal?: boolean;
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

/**
 * A declared FK relationship on a whitelisted table — authored in the schema
 * whitelist UI (per table, like MetricDef), versioned and inherited the same
 * way. This is the ONE semantic input that cannot be derived from profiled
 * columns; everything else in a SemanticModel is derived from the schema.
 * Lookup-only cardinality (many_to_one / one_to_one), same rationale as
 * SemanticJoinRelationship.
 */
export interface TableRelationship {
  /** Connection (database) name both tables live in. */
  connection: string;
  schema?: string;
  /** Base ("many") table the FK column lives on. */
  table: string;
  /** FK column on the base table. */
  column: string;
  targetSchema?: string;
  /** Lookup ("one") table the FK points at. */
  targetTable: string;
  /** Matched column on the lookup table (usually its PK). */
  targetColumn: string;
  /** Cardinality from the base table's perspective. Default: many_to_one. */
  relationship?: SemanticJoinRelationship;
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
