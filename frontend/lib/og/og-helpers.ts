/** Pure helpers for Open Graph share cards (no DB/server deps — unit-testable). */

/** Product tagline — the generic card's hero line and the default share description. */
export const MINUSX_TAGLINE = 'Your data stack, staffed by agents';

/**
 * S3 key for a story's cached OG image. Includes `updated_at` so any edit produces a fresh
 * key — the cache self-busts.
 */
export function ogCacheKey(fileId: number, updatedAt: string): string {
  return `og/${fileId}-${updatedAt.replace(/[^\w-]/g, '')}.png`;
}

/** Trim text to a max length for the card, adding an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}
