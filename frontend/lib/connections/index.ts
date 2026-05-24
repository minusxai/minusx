import 'server-only';
import type { NodeConnector } from './base';
import { DuckDbConnector } from './duckdb-connector';
import { CsvConnector } from './csv-connector';
import { PostgresConnector } from './postgres-connector';
import { BigQueryConnector } from './bigquery-connector';
import { AthenaConnector } from './athena-connector';
import { InternalDbConnector } from './internal-db-connector';
import { SqliteConnector } from './sqlite-connector';
import { MongoConnector } from './mongo-connector';

export type {
  SchemaEntry,
  SchemaTable,
  SchemaColumn,
  QueryResult,
  TestConnectionResult,
  ConnectorConfigMap,
  ConnectorDialect,
  DuckDbConfig,
  SqliteConfig,
  PostgresConfig,
  BigQueryConfig,
  AthenaConfig,
  CsvConfig,
  MongoConfig,
} from './base';
export { NodeConnector } from './base';
export { getOrCreateDuckDbInstance } from './duckdb-registry';
export { DuckDbConnector, resolveDuckDbFilePath } from './duckdb-connector';
export { CsvConnector } from './csv-connector';
export { PostgresConnector } from './postgres-connector';
export { BigQueryConnector } from './bigquery-connector';
export { AthenaConnector } from './athena-connector';
export { InternalDbConnector } from './internal-db-connector';
export { SqliteConnector } from './sqlite-connector';

/**
 * Factory: return a NodeConnector for the given type, or null if the type is unknown.
 * All analytics connector types (postgresql, bigquery, athena, duckdb, csv, google-sheets)
 * are all handled by the Node.js connectors.
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
  if (type === 'postgresql') {
    return new PostgresConnector(name, config);
  }

  if (type === 'bigquery') {
    return new BigQueryConnector(name, config);
  }

  if (type === 'athena') {
    return new AthenaConnector(name, config);
  }

  if (type === 'duckdb') {
    return new DuckDbConnector(name, config);
  }

  if (type === 'sqlite') {
    return new SqliteConnector(name, config);
  }

  if (type === 'csv') {
    if (Array.isArray(config.files)) return new CsvConnector(name, config);
    return null;
  }

  if (type === 'google-sheets') {
    if (Array.isArray(config.files)) return new CsvConnector(name, config);
    return null;
  }

  if (type === 'internal_db') {
    return new InternalDbConnector(name, config);
  }

  if (type === 'mongo') {
    return new MongoConnector(name, config);
  }

  return null;
}
