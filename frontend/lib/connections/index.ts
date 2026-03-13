import 'server-only';
import type { NodeConnector } from './base';
import { DuckDbConnector } from './duckdb-connector';

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

type ConnectorConstructor = new (name: string, config: Record<string, any>) => NodeConnector;

// Registry of Node.js connector types — mirrors Python's CONNECTOR_REGISTRY
const CONNECTOR_REGISTRY: Record<string, ConnectorConstructor> = {
  duckdb: DuckDbConnector,
  // csv and google-sheets both use DuckDB under the hood (generated_db_path)
  csv: DuckDbConnector,
  'google-sheets': DuckDbConnector,
};

/**
 * Factory: return a NodeConnector for the given type, or null if not handled
 * by Node.js (e.g. bigquery, postgresql stay on Python).
 */
export function getNodeConnector(
  name: string,
  type: string,
  config: Record<string, any>
): NodeConnector | null {
  const ConnectorClass = CONNECTOR_REGISTRY[type];
  if (!ConnectorClass) return null;

  // csv / google-sheets store their DuckDB file under generated_db_path
  const resolvedConfig =
    (type === 'csv' || type === 'google-sheets') && config.generated_db_path
      ? { file_path: config.generated_db_path }
      : config;

  return new ConnectorClass(name, resolvedConfig);
}
