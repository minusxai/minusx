/**
 * Query hash utilities
 * Shared between client and server for consistent query result caching
 */

/**
 * Generate hash key for query lookup
 * Simple string concatenation with delimiter
 *
 * Used for:
 * - Caching query results in Redux (queryResultsSlice)
 * - Storing queryResultId in question content
 */
export function getQueryHash(query: string, params: Record<string, any>, database: string): string {
  const paramStr = JSON.stringify(params);
  return `${database}|||${query}|||${paramStr}`;
}
