/**
 * Connection helper functions
 * Validation, config sanitization, and constants
 */

/**
 * Reserved connection names that cannot be used
 */
export const RESERVED_NAMES = ['default_db'];

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
