/**
 * Database Selection Utilities
 *
 * Centralizes logic for selecting a database from a list of available databases.
 * Used across:
 * - Question page DB selection
 * - Sidechat context DB selection
 * - Autocomplete SQL DB
 * - Mentions tables DB
 */

import { DatabaseContext, DatabaseConnection } from '@/lib/types';

/**
 * Type that represents any object with a database name
 * Supports DatabaseContext, DatabaseConnection, DatabaseWithSchema, and simple objects
 */
type DatabaseLike = DatabaseContext | DatabaseConnection | { databaseName: string } | { name: string } | { metadata: { name: string } };

/**
 * Extract database name from any database-like object
 */
function extractDatabaseName(db: DatabaseLike): string {
  // DatabaseContext or DatabaseWithSchema (has databaseName)
  if ('databaseName' in db) {
    return db.databaseName;
  }
  // DatabaseConnection (has name)
  if ('name' in db) {
    return db.name;
  }
  // Object with metadata.name
  if ('metadata' in db && db.metadata && 'name' in db.metadata) {
    return db.metadata.name;
  }
  return '';
}

/**
 * Select the best database from a list of available databases
 *
 * Selection strategy:
 * 1. If preferredDatabase is provided and exists in the list, use it
 * 2. Otherwise, use the first database in the list
 * 3. If no databases available, return empty string
 *
 * @param databases - Array of available databases (from context, connections, or any database-like objects)
 * @param preferredDatabase - Optional preferred database name (from question, dashboard, or user selection)
 * @returns Selected database name, or empty string if no databases available
 */
export function selectDatabase(
  databases: Array<DatabaseLike> | undefined,
  preferredDatabase?: string | null
): string {
  // No databases available - return empty string for graceful degradation
  if (!databases || databases.length === 0) {
    return '';
  }

  // Extract database names
  const databaseNames = databases.map(extractDatabaseName).filter(Boolean);

  // If no valid database names after extraction
  if (databaseNames.length === 0) {
    return '';
  }

  // If preferred database is specified and exists, use it
  if (preferredDatabase && databaseNames.includes(preferredDatabase)) {
    return preferredDatabase;
  }

  // Otherwise, use first database
  return databaseNames[0];
}

/**
 * Get the first database name from a list (legacy helper)
 *
 * This is a convenience wrapper around selectDatabase for cases where
 * you just want the first database without any preference logic.
 *
 * @param databases - Array of available databases
 * @returns First database name, or empty string if no databases available
 */
export function getFirstDatabase(
  databases: Array<DatabaseLike> | undefined
): string {
  return selectDatabase(databases, null);
}

/**
 * Validate if a database name exists in the available databases
 *
 * @param databases - Array of available databases
 * @param databaseName - Database name to validate
 * @returns true if database exists, false otherwise
 */
export function isDatabaseAvailable(
  databases: Array<DatabaseLike> | undefined,
  databaseName: string | null | undefined
): boolean {
  if (!databases || !databaseName) {
    return false;
  }

  const databaseNames = databases.map(extractDatabaseName).filter(Boolean);
  return databaseNames.includes(databaseName);
}
