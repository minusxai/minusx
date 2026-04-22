import path from 'path';
import { IS_DEV } from '../constants';
import { DB_TYPE, PGLITE_DATA_DIR_ENV, BASE_DUCKDB_DATA_PATH } from '../config';

export function getDbType(): 'postgres' | 'pglite' {
  return DB_TYPE;
}

// PGLite persists to a directory, not a file.
// Explicit PGLITE_DATA_DIR overrides; otherwise derived from BASE_DUCKDB_DATA_PATH.
export const PGLITE_DATA_DIR = PGLITE_DATA_DIR_ENV
  ?? path.join(BASE_DUCKDB_DATA_PATH, 'data', 'pglite');
