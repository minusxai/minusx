// V2 Benchmark Analyst: 4-tool primitive set with handle-based data model
import { V2BenchmarkAnalystAgent } from './v2-agent';
import { V2DoubleCheckBenchmarkAgent } from './v2-double-check';
import { SearchDBSchemaV2 } from './search-db-schema';
import { ExecuteQueryV2 } from './execute-query';
import { ExploreV2 } from './explore';
import { FetchHandleV2 } from './fetch-handle';

export {
  V2BenchmarkAnalystAgent,
  V2DoubleCheckBenchmarkAgent,
  SearchDBSchemaV2,
  ExecuteQueryV2,
  ExploreV2,
  FetchHandleV2,
};

/** The four V2 data primitives, registered together. Single source of truth
 *  for both benchmark CLI runs and v=2 chat continuation. */
export const V2_DATA_TOOLS = [SearchDBSchemaV2, ExecuteQueryV2, ExploreV2, FetchHandleV2] as const;

export { interpolateRefs, interpolateMongoRefs, detectLowLimit } from './query-refs';
export { storeHandle, fetchHandle, clearHandles, getHandleTable, queryHandle } from './handle-store';
export { computeResultStats, type ResultStats, type ColumnStats } from './result-stats';
export { buildCatalog, type CatalogTables, type CatalogTable } from './catalog';
export { DIALECT_HINTS, renderDialectHints, extractDialects } from './dialect-hints';
