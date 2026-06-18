/**
 * Map a connection type to a SQL dialect string used for dialect-specific SQL.
 */
export function connectionTypeToDialect(connectionType: string): string {
  switch (connectionType) {
    case 'duckdb':
      return 'duckdb';
    case 'bigquery':
      return 'bigquery';
    case 'athena':
      return 'awsathena';
    case 'csv':
    case 'google-sheets':
      return 'duckdb';
    case 'clickhouse':
      return 'clickhouse';
    case 'postgresql':
    default:
      return 'postgresql';
  }
}
