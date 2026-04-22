/**
 * Utility for determining context (knowledge base) status of datasets
 * within the static CSV/xlsx connection.
 *
 * A "dataset" in the static connection maps to a schema. It is considered
 * "in context" if the whitelist covers it through any of these paths:
 *   1. Global wildcard ('*') — all connections exposed
 *   2. The 'static' connection is whitelisted with no schema filter (children: undefined)
 *   3. The specific schema is explicitly listed under the 'static' connection
 *
 * The filtering is already performed by `applyWhitelistToConnections()` before
 * data reaches this function — so `whitelistedSchemas` contains the pre-filtered
 * result. This function simply checks membership in that filtered list.
 */

interface SchemaInfo {
  schema: string;
  tables?: Array<{ table: string; columns?: Array<{ name: string; type: string }> }>;
}

export interface DatasetContextStatus {
  /** Whether this dataset (schema) is covered by the context whitelist */
  inContext: boolean;
  /** Number of tables whitelisted (undefined if not in context) */
  whitelistedTableCount?: number;
  /** Total tables in the dataset */
  totalTableCount: number;
  /** Whether all tables in the dataset are whitelisted */
  fullyWhitelisted: boolean;
}

/**
 * Determine whether a dataset (schema) is in the user's knowledge base context.
 *
 * @param schemaName - The dataset/schema name to check (e.g. 'public', 'ships')
 * @param totalTableCount - Total number of tables in the dataset
 * @param whitelistedSchemas - Pre-filtered schemas from the context whitelist.
 *   `undefined` means no context exists at all.
 *   Empty array means context exists but this connection isn't whitelisted.
 */
export function getDatasetContextStatus(
  schemaName: string,
  totalTableCount: number,
  whitelistedSchemas: SchemaInfo[] | undefined,
): DatasetContextStatus {
  // No context exists — nothing is whitelisted
  if (whitelistedSchemas === undefined) {
    return { inContext: false, totalTableCount, fullyWhitelisted: false };
  }

  const matchedSchema = whitelistedSchemas.find((s) => s.schema === schemaName);

  if (!matchedSchema) {
    return { inContext: false, totalTableCount, fullyWhitelisted: false };
  }

  // Schema is whitelisted — check table coverage
  const whitelistedTableCount = matchedSchema.tables?.length ?? 0;

  // If the whitelisted schema has no explicit table list, all tables are exposed
  // (this happens when the schema is whitelisted at the schema level without table filtering)
  const fullyWhitelisted = whitelistedTableCount === 0 || whitelistedTableCount >= totalTableCount;

  return {
    inContext: true,
    whitelistedTableCount: whitelistedTableCount || totalTableCount,
    totalTableCount,
    fullyWhitelisted,
  };
}
