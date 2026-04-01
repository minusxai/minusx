/**
 * Centralized database configuration
 * Provides environment-aware database paths and adapter type
 */
import path from 'path';
import { IS_DEV, DB_TYPE } from '../constants';

/**
 * Get database adapter type.
 * Tests mock this function directly via jest.mock('../db-config').
 */
export function getDbType(): 'sqlite' | 'postgres' {
  return DB_TYPE;
}

// Environment-aware database path
// Production (Docker): /app/data/atlas_documents.db
// Local dev: ../data/atlas_documents.db (from frontend directory)
export const DB_PATH = IS_DEV
  ? path.join(process.cwd(), '..', 'data', 'atlas_documents.db')
  : path.join(process.cwd(), 'data', 'atlas_documents.db');

export const DB_DIR = path.dirname(DB_PATH);
