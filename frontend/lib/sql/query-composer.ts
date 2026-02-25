/**
 * Query Composer Utilities
 * Handles conversion of @references to CTEs for query execution
 */

export interface ResolvedReference {
  id: number;
  alias: string;
  query: string;
  inferredColumns?: { name: string; type: string }[];
}

/**
 * Converts a query with @references to a query with CTEs.
 * Replaces @alias with alias and wraps query with WITH clause.
 *
 * @param query - SQL query with @reference syntax
 * @param references - Array of resolved references with their queries
 * @returns Query with CTEs replacing @references
 *
 * @example
 * // Input:
 * query = "SELECT * FROM @revenue WHERE total > 1000"
 * references = [{ id: 1, alias: "revenue", query: "SELECT SUM(amount) as total FROM orders" }]
 *
 * // Output:
 * "WITH revenue AS (
 *   SELECT SUM(amount) as total FROM orders
 * )
 * SELECT * FROM revenue WHERE total > 1000"
 */
export function CTEfyQuery(
  query: string,
  references: ResolvedReference[]
): string {
  if (!references || references.length === 0) {
    return query;
  }

  // Build CTEs from references
  const ctes = references
    .map(ref => `${ref.alias} AS (\n${ref.query}\n)`)
    .join(',\n');

  // Replace @alias with alias in the main query
  let processedQuery = query;
  references.forEach(ref => {
    const pattern = new RegExp(`@${ref.alias}\\b`, 'g');
    processedQuery = processedQuery.replace(pattern, ref.alias);
  });

  // Wrap with WITH clause
  return `WITH ${ctes}\n${processedQuery}`;
}
