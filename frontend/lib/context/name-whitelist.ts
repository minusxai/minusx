/**
 * The NAME whitelist — how a context selects which inherited data models and
 * semantic models it takes.
 *
 * Deliberately the same shape and defaults as the table whitelist (`'*' |
 * WhitelistNode[]`, absent read as `'*'`): one mental model for "what did I take
 * from my parent", one affordance in the editor, one story in the docs. The
 * wildcard is the substance of it — `'*'` means "everything offered, INCLUDING
 * what is added later", which an explicit list cannot express. Leaving the
 * wildcard therefore freezes your selection, exactly as it does for tables.
 *
 * It is the child's half of inheritance. The parent's half is `childPaths` on the
 * model itself (who is offered it at all).
 */
import type { NameWhitelist } from '@/lib/types';

/** Is `name` taken? Absent or `'*'` takes everything. */
export function nameWhitelisted(whitelist: NameWhitelist | undefined, name: string): boolean {
  return whitelist === undefined || whitelist === '*' || whitelist.includes(name);
}

/** Narrow an offering to what the whitelist takes, in the offered order. */
export function applyNameWhitelist<T extends { name: string }>(
  offered: T[],
  whitelist: NameWhitelist | undefined,
): T[] {
  if (whitelist === undefined || whitelist === '*') return offered;
  const allowed = new Set(whitelist);
  return offered.filter((e) => allowed.has(e.name));
}

/**
 * Flip one name, given everything currently on offer.
 *
 * Unchecking under the wildcard materialises the selection first (the same
 * two-step the schema tree takes when you leave "select all"). Re-checking the
 * last missing name collapses back to `'*'` — without that, a fully-checked
 * explicit list would look identical to the wildcard while silently refusing
 * every model added later.
 */
export function toggleNameWhitelist(
  whitelist: NameWhitelist | undefined,
  offeredNames: string[],
  name: string,
): NameWhitelist {
  const current = whitelist === undefined || whitelist === '*' ? offeredNames : whitelist;
  const next = current.includes(name)
    ? current.filter((n) => n !== name)
    : [...current, name];
  return offeredNames.every((n) => next.includes(n)) ? '*' : next;
}
