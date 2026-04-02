/**
 * Map a connection type to a SQL dialect string used by the Python backend.
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
    case 'postgresql':
    default:
      return 'postgresql';
  }
}
