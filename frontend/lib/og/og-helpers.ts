/** Pure helpers for Open Graph share cards (no DB/server deps — unit-testable). */

/** Product tagline — the generic card's hero line and the default share description. */
export const MINUSX_TAGLINE = 'Your data stack, staffed by agents';

/**
 * S3 key for a story's cached OG image. Includes `updated_at` so any edit produces a fresh
 * key — the cache self-busts. Accepts a Date because the `pg` driver (prod) returns TIMESTAMP
 * columns as Date objects, while PGLite (dev) returns ISO strings — normalize to ISO so the
 * key is stable across drivers.
 */
export function ogCacheKey(fileId: number, updatedAt: string | Date): string {
  const iso = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
  return `og/${fileId}-${iso.replace(/[^\w-]/g, '')}.png`;
}

/** Trim text to a max length for the card, adding an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}
