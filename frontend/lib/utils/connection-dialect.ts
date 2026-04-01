export function connectionTypeToDialect(type: string): string {
  switch (type) {
    case 'duckdb':
    case 'csv':
    case 'google-sheets':
      return 'duckdb';
    case 'bigquery':
      return 'bigquery';
    case 'athena':
      return 'presto';
    case 'postgresql':
    default:
      return 'postgres';
  }
}
