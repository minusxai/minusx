/**
 * Centralized database configuration
 * Provides environment-aware database paths and adapter type
 */
import path from 'path';
import { IS_DEV } from '../constants';

/**
 * Get database adapter type
 * Reads from DB_TYPE environment variable on each call, defaults to 'sqlite'
 * Using a getter function ensures tests can override the environment variable
 */
export function getDbType(): 'sqlite' | 'postgres' {
  return (process.env.DB_TYPE as 'sqlite' | 'postgres') || 'sqlite';
}

/**
 * Database adapter type constant (for convenience)
 * Note: This is evaluated once at module load time.
 * For test flexibility, use getDbType() instead.
 */
export const DB_TYPE = getDbType();

// Environment-aware database path
// Production (Docker): /app/data/atlas_documents.db
// Local dev: ../data/atlas_documents.db (from frontend directory)
export const DB_PATH = IS_DEV
  ? path.join(process.cwd(), '..', 'data', 'atlas_documents.db')
  : path.join(process.cwd(), 'data', 'atlas_documents.db');

export const DB_DIR = path.dirname(DB_PATH);
