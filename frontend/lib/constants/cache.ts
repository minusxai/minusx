/**
 * Cache TTL (Time-To-Live) constants
 *
 * These control how long data is considered "fresh" before refetching
 */

// Cache durations in milliseconds
const TEN_HOURS = 10 * 60 * 60 * 1000;
const TWO_MINUTES = 2 * 60 * 1000;

export const CACHE_TTL = {
  /** File cache TTL (used by useFile hook) */
  FILE: TEN_HOURS,

  /** Folder cache TTL (used by useFolder hook) */
  FOLDER: TEN_HOURS,

  /** Query result cache TTL (used by useQueryResult hook) */
  QUERY: TWO_MINUTES,  // Short TTL for development - change to TEN_HOURS for production
} as const;
