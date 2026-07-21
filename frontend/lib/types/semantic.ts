// ============================================================================
// Semantic layer types (Semantic_Model_v2.md).
//
// The authored model shape is TypeBox single-source in
// lib/validation/atlas-schemas.ts; the Static types are RE-EXPORTED below —
// do not hand-write duplicates.
//
// The vocabulary intentionally mirrors the open semantic layer specs
// (MetricFlow / Cube / OSI): source, explicit references, dimensions,
// measures, metrics — so an interchange import/export stays a trivial mapping.
// ============================================================================

export type {
  SemanticSource,
  SemanticReference,
  SemanticReferenceToOne,
  SemanticReferenceM2M,
  SemanticDimensionV2,
  SemanticMeasureV2,
  SemanticRatioMetricV2,
  SemanticSqlMetric,
  SemanticMetricV2,
  SemanticModelV2,
} from '@/lib/validation/atlas-schemas';

export type SemanticAggregate = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';

export type SemanticTimeGrain = 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
