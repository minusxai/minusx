/**
 * Connection helper functions
 * Validation, config sanitization, and constants
 */

import { IS_DEV } from '@/lib/constants';

/**
 * Reserved connection names that cannot be used
 */
// 'static' is the shared CSV/Google Sheets landing zone — one per mode, cannot be deleted or renamed
export const RESERVED_NAMES = ['static'];

/** Connection types only available in development (NODE_ENV !== 'production'). */
export const DEV_ONLY_CONNECTION_TYPES = ['duckdb', 'sqlite'];

/**
 * Reject dev-only connection types in production.
 * @throws Error if the type is dev-only and we're in production
 */
export function validateConnectionType(type: string): void {
  if (!IS_DEV && DEV_ONLY_CONNECTION_TYPES.includes(type)) {
    throw new Error(`Connection type '${type}' is only available in development mode`);
  }
}

export function validateDuckDbFilePath(type: string, _config: Record<string, any>): void {
  if (type !== 'duckdb') return;
  // No additional validation needed
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
      files: config.files || []
    };
  }

  if (type === 'google-sheets') {
    // Google Sheets config is safe to return (no sensitive data)
    return {
      spreadsheet_url: config.spreadsheet_url,
      spreadsheet_id: config.spreadsheet_id,
      schema_name: config.schema_name,
      files: config.files || []
    };
  }

  return {};
}
