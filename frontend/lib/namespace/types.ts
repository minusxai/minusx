/**
 * Namespaces — isolating effects between workspaces.
 *
 * The app already separates state along two axes: which workspace a request belongs to,
 * and which mode within it (`/org` vs `/tutorial`). Both are prefixes on the same
 * things — object-store keys, cache keys, channel names — but each consumer derived its
 * own prefix by hand, so adding a coarser axis meant editing every call site.
 *
 * A `Namespace` is those prefixes, already joined, coarse to fine. Call sites name the
 * level they need and never build a path themselves — so a deployment that inserts a
 * coarser level ahead of `mode` changes no call site at all.
 */

/**
 * Request header carrying the sealed namespace from middleware to route handlers.
 *
 * Named here rather than in each consumer so the two ends cannot disagree — a mismatch
 * would present as "no namespace" on every request, which reads like a configuration
 * problem rather than a typo.
 */
export const NAMESPACE_HEADER = 'x-namespace-context';

/** Separator for every level. `/` keeps object-store keys in their natural path shape. */
export const NAMESPACE_SEPARATOR = '/';

/**
 * The root level of a single-workspace deployment. Non-empty on purpose: an empty
 * root would make `${ns.isolation}/${key}` emit a leading separator, so every call site
 * would need an emptiness check.
 */
export const DEFAULT_ISOLATION = 'mx';

export interface Namespace {
  /**
   * Coarsest — the isolation boundary. Everything durable is keyed by this: object
   * storage, notification channels, anything that must never be visible across the
   * boundary. Deliberately excludes `mode`, so the same stored object is reachable
   * from every mode within one workspace.
   */
  isolation: string;
  /** `isolation` + the request's mode. */
  mode: string;
  /** `mode` + the user. The finest grain — identity-scoped caches. */
  user: string;
}

/**
 * Build the levels. Prefixes are joined once, here, so nothing downstream concatenates.
 *
 * A deployment serving several workspaces passes its own `isolation`; everything below
 * is unchanged, which is what lets a coarser axis be inserted without touching a single
 * consumer.
 */
export function buildNamespace(parts: {
  isolation?: string;
  mode: string;
  userId: number | string;
}): Namespace {
  const isolation = parts.isolation ?? DEFAULT_ISOLATION;
  const mode = [isolation, parts.mode].join(NAMESPACE_SEPARATOR);
  return {
    isolation,
    mode,
    user: [mode, String(parts.userId)].join(NAMESPACE_SEPARATOR),
  };
}

/**
 * Prefix a key with a namespace level.
 *
 * Exists so no call site writes `${ns.mode}/${key}` by hand — hand-built paths are
 * where a stray or missing separator silently changes every key in a store.
 */
export function namespaced(level: string, key: string): string {
  return level + NAMESPACE_SEPARATOR + key.replace(/^\/+/, '');
}

/**
 * Notification channel names are SQL identifiers, so they cannot carry `/` without
 * quoting. Same isolation level, different join.
 *
 * The leading `ns` is not decoration: an identifier may not START with a digit, and a
 * numeric isolation value would otherwise produce `1_conv_7`, which Postgres rejects as
 * a malformed numeric literal. LISTEN then throws and the stream never subscribes.
 */
export function namespacedChannel(isolation: string, channel: string): string {
  return `ns${isolation.replace(/[^a-zA-Z0-9_]/g, '_')}_${channel}`;
}
