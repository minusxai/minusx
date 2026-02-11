/**
 * Slug utility functions for generating URL-friendly strings
 * Used for creating pretty URLs like /f/1-sales-dashboard
 */

/**
 * Convert a string to a URL-friendly slug
 * Examples:
 *   "Sales Dashboard" -> "sales-dashboard"
 *   "Q1 2024 Revenue" -> "q1-2024-revenue"
 *   "User Activity (Top 10)" -> "user-activity-top-10"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // Replace spaces and underscores with hyphens
    .replace(/[\s_]+/g, '-')
    // Remove all non-alphanumeric characters except hyphens
    .replace(/[^a-z0-9-]/g, '')
    // Replace multiple consecutive hyphens with single hyphen
    .replace(/-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse a file ID from URL format
 * Supports:
 *   "1" -> { intId: 1, slug: null }
 *   "1-sales-dashboard" -> { intId: 1, slug: "sales-dashboard" }
 *   "123-my-report" -> { intId: 123, slug: "my-report" }
 */
export function parseFileId(rawId: string): { intId: number; slug: string | null } {
  // Split by first hyphen
  const parts = rawId.split('-');
  const intId = parseInt(parts[0], 10);

  if (isNaN(intId)) {
    throw new Error(`Invalid file ID format: ${rawId}`);
  }

  // If there are more parts, join them as slug
  const slug = parts.length > 1 ? parts.slice(1).join('-') : null;

  return { intId, slug };
}

/**
 * Generate a full file URL with ID and slug
 * Examples:
 *   (1, "Sales Dashboard") -> "1-sales-dashboard"
 *   (42, "Q1 Revenue") -> "42-q1-revenue"
 */
export function generateFileUrl(id: number, name: string): string {
  const slug = slugify(name);
  return slug ? `${id}-${slug}` : `${id}`;
}
