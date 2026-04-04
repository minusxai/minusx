/**
 * Helpers for creating immutable module-level collections.
 *
 * Use these instead of `new Set()` / `new Map()` for constants.
 * TypeScript enforces immutability via ReadonlySet/ReadonlyMap — .add(), .delete(),
 * .clear() are compile errors on the returned type.
 *
 * The ESLint rule that guards module-level Maps/Sets only fires on `new Map/Set` —
 * not on these helpers — so no eslint-disable comment is needed at call sites.
 */

export function immutableSet<T>(values: Iterable<T>): ReadonlySet<T> {
  return new Set(values);
}

export function immutableMap<K, V>(entries: Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  return new Map(entries);
}
