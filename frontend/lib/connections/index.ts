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
 *   - Legacy format (generated_db_path)  → DuckDbConnector (local file)
 *   - New S3-backed format (files array) → CsvConnector (in-memory DuckDB + httpfs)
 * Google Sheets:
 *   - Legacy (generated_db_path) → DuckDbConnector
 *   - No S3-backed variant exists yet → falls through to Python
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
    // S3-backed: files array present → Node.js CsvConnector (in-memory DuckDB + httpfs)
    if (Array.isArray(config.files)) return new CsvConnector(name, config);
    // Legacy: generated_db_path → local DuckDB file
    if (config.generated_db_path) return new DuckDbConnector(name, { file_path: config.generated_db_path });
    return null;
  }

  if (type === 'google-sheets' && config.generated_db_path) {
    return new DuckDbConnector(name, { file_path: config.generated_db_path });
  }

  return null;
}
