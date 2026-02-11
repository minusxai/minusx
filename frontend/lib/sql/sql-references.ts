import { QuestionReference } from '../types';

/**
 * Extract reference aliases from SQL query using @{slug}_{id} syntax
 * Example: @revenue_by_month_43 extracts "revenue_by_month_43"
 */
export function extractReferencesFromSQL(sql: string): string[] {
  if (!sql) {
    return [];
  }
  // Match @{slug}_{id} pattern (e.g., @revenue_by_month_43)
  // Slug is word characters, ends with underscore and digits (ID)
  const regex = /@(\w+_\d+)/g;
  const matches = sql.matchAll(regex);
  const aliases = new Set<string>();

  for (const match of matches) {
    aliases.add(match[1]);
  }

  return Array.from(aliases);
}

/**
 * Parse a reference alias to extract question ID and slug
 * Example: "revenue_by_month_43" -> { id: 43, slug: "revenue_by_month" }
 */
export function parseReferenceAlias(alias: string): { id: number; slug: string } | null {
  const match = alias.match(/^(.+)_(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    id: parseInt(match[2], 10),
    slug: match[1]
  };
}

/**
 * Generate a slug from a question name
 * Converts to lowercase, replaces spaces and special chars with underscores
 * Example: "Revenue by Month" -> "revenue_by_month"
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')  // Replace non-alphanumeric with underscore
    .replace(/^_+|_+$/g, '')       // Trim leading/trailing underscores
    .replace(/_+/g, '_');          // Collapse multiple underscores
}

/**
 * Generate a reference alias from question ID and name
 * Example: (43, "Revenue by Month") -> "revenue_by_month_43"
 */
export function generateReferenceAlias(id: number, name: string): string {
  const slug = generateSlug(name);
  return `${slug}_${id}`;
}

/**
 * Sync references with SQL query
 * - Add new references found in SQL (by parsing ID from alias)
 * - Remove references not in SQL
 * - Keep existing reference configurations
 *
 * @param sql - The SQL query string
 * @param currentRefs - Current references array
 * @returns Updated references array
 */
export function syncReferencesWithSQL(
  sql: string,
  currentRefs: QuestionReference[] = []
): QuestionReference[] {
  const aliasesInSQL = extractReferencesFromSQL(sql);
  const safeCurrentRefs = Array.isArray(currentRefs) ? currentRefs : [];
  const currentRefMap = new Map(safeCurrentRefs.map((r) => [r.id, r]));

  // Build new reference list
  const newRefs: QuestionReference[] = [];
  const seenIds = new Set<number>();

  for (const alias of aliasesInSQL) {
    const parsed = parseReferenceAlias(alias);
    if (!parsed) {
      // Invalid alias format, skip
      continue;
    }

    // Skip duplicates (same ID referenced multiple times with different slugs)
    if (seenIds.has(parsed.id)) {
      continue;
    }
    seenIds.add(parsed.id);

    const existing = currentRefMap.get(parsed.id);
    if (existing) {
      // Keep existing reference but update alias if it changed
      newRefs.push({
        ...existing,
        alias: alias  // Update alias to match what's in SQL
      });
    } else {
      // Create new reference
      newRefs.push({
        id: parsed.id,
        alias: alias
      });
    }
  }

  return newRefs;
}

/**
 * Check if a reference alias is valid (matches @{slug}_{id} format)
 */
export function isValidReferenceAlias(alias: string): boolean {
  return /^\w+_\d+$/.test(alias);
}
