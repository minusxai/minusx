/**
 * Shared CSV utility functions — safe to import from both server and client components.
 * (No `server-only` guard here.)
 */

/**
 * Convert a filename into a valid DuckDB table name.
 * Strips extension, lowercases, replaces non-alphanumeric chars with underscores,
 * strips leading/trailing underscores, prefixes digit-leading names with `t_`,
 * and truncates to 63 chars.
 */
export function sanitizeTableName(filename: string): string {
  let name = filename.replace(/\.[^.]+$/, ''); // strip extension
  name = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (/^\d/.test(name)) name = 't_' + name;
  name = name.slice(0, 63);
  return name || 'table';
}

/**
 * Assign unique table names to a list of filenames.
 * Where two files would produce the same sanitized name, appends `_2`, `_3`, etc.
 * Returns a Map<filename, uniqueTableName>.
 */
export function ensureUniqueTableNames(filenames: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const filename of filenames) {
    const base = sanitizeTableName(filename);
    let name = base;
    let counter = 2;
    while (used.has(name)) name = `${base}_${counter++}`;
    result.set(filename, name);
    used.add(name);
  }
  return result;
}

/** Regex pattern for valid schema/table names: lowercase letters, digits, underscores. */
export const NAME_PATTERN = /^[a-z0-9_]+$/;

/** Validate a schema or table name. Returns an error string or null if valid. */
export function validateIdentifier(value: string): string | null {
  if (!value) return 'Name is required';
  if (!NAME_PATTERN.test(value)) return 'Lowercase letters, numbers, and underscores only';
  return null;
}
