import 'server-only';
import type { NodeConnector } from './base';
import { DuckDbConnector } from './duckdb-connector';
import { CsvConnector } from './csv-connector';

export type {
  SchemaEntry,
  SchemaTable,
  SchemaColumn,
  QueryResult,
  TestConnectionResult,
} from './base';
export { NodeConnector } from './base';
export { getOrCreateDuckDbInstance } from './duckdb-registry';
export { DuckDbConnector, resolveDuckDbFilePath } from './duckdb-connector';
export { CsvConnector } from './csv-connector';

/**
 * Factory: return a NodeConnector for the given type, or null if not handled
 * by Node.js (e.g. bigquery, postgresql stay on Python).
 *
 * CSV routing:
 *   - S3-backed format (files array) → CsvConnector (in-memory DuckDB + httpfs)
 * Google Sheets:
 *   - S3-backed format (files array) → CsvConnector (same as CSV)
 */
export function getNodeConnector(
  name: string,
  type: string,
  config: Record<string, any>
): NodeConnector | null {
  if (type === 'duckdb') {
    return new DuckDbConnector(name, config);
  }

  if (type === 'csv') {
    if (Array.isArray(config.files)) return new CsvConnector(name, config);
    return null;
  }

  if (type === 'google-sheets') {
    if (Array.isArray(config.files)) return new CsvConnector(name, config);
    return null;
  }

  return null;
}
