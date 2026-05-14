/**
 * V2 Benchmark Analyst — handle-based query results with 4 sharp primitives.
 */

// Agent
export { V2BenchmarkAnalystAgent } from './v2-agent';

// Tools
export { SearchDBSchemaV2, setSearchModel } from './search-db-schema';
export { ExecuteQueryV2, setExecuteModel } from './execute-query';
export { Explore, setExploreModel } from './explore';
export { FetchHandle } from './fetch-handle';

// Utilities
export { interpolateRefs, interpolateMongoRefs, detectLowLimit } from './query-refs';
export { storeHandle, getHandle, hasHandle, clearHandles, handleCount, getAllHandles } from './handle-store';
export { computeResultStats, type ResultStats, type ColumnStats, type TopValue } from './result-stats';
export { buildCatalog, catalogToMarkdown, type CatalogData } from './catalog';
export { DIALECT_HINTS, renderDialectHints, extractDialects } from './dialect-hints';
