/**
 * Connection helper functions
 * Validation, config sanitization, and constants
 */

/**
 * Reserved connection names that cannot be used
 */
export const RESERVED_NAMES = ['default_db'];

/**
 * Block DuckDB connections that point to another company's analytics DB.
 * Analytics DBs are named "{companyId}.duckdb". Users may only reference their own.
 * @throws Error if the path targets a different company's analytics DB
 */
export function validateDuckDbFilePath(type: string, config: Record<string, any>, companyId: number): void {
  if (type !== 'duckdb') return;

  const filePath: string = config?.file_path || '';
  // Extract the final path segment (works on both / and \ separators)
  const filename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const match = /^(\d+)\.duckdb$/i.exec(filename);
  if (!match) return; // not a numeric-named DuckDB file — allow it

  const fileCompanyId = parseInt(match[1], 10);
  if (fileCompanyId !== companyId) {
    throw new Error('Access denied: cannot connect to another company\'s analytics database');
  }
}

/**
 * Validate connection name format
 * @throws Error if name is invalid
 */
export function validateConnectionName(name: string): void {
  if (!name) {
    throw new Error('Connection name is required');
  }
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error('Connection name must contain only lowercase letters, numbers, and underscores');
  }
}

/**
 * Get safe config (filter sensitive fields like credentials)
 * Only returns fields safe to send to client
 */
export function getSafeConfig(type: string, config: any): Record<string, any> {
  if (type === 'bigquery') {
    // Hide service_account_json
    return { project_id: config.project_id };
  }

  if (type === 'duckdb') {
    return { file_path: config.file_path };
  }

  if (type === 'postgresql') {
    // Hide username/password
    return {
      host: config.host,
      port: config.port,
      database: config.database
    };
  }

  if (type === 'csv') {
    // CSV config is safe to return (no sensitive data)
    return {
      generated_db_path: config.generated_db_path,
      files: config.files || []
    };
  }

  if (type === 'google-sheets') {
    // Google Sheets config is safe to return (no sensitive data)
    return {
      spreadsheet_url: config.spreadsheet_url,
      spreadsheet_id: config.spreadsheet_id,
      generated_db_path: config.generated_db_path,
      files: config.files || []
    };
  }

  return {};
}
