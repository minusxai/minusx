/**
 * Story embed resize — pure size logic shared by the resize-handle UI (StoryResizeHandles).
 *
 * Story embeds carry their size as an inline `style="width:..px;height:..px"` on the placeholder
 * (AgentHtml.sizeEmbedEl). Stories are a flow document (no x/y canvas), so a resized box stays
 * top-left anchored: every handle only changes width/height, never the origin.
 *
 * serialize-story.ts restores the AUTHORED style snapshot from `data-mx-osz` on save and discards the
 * live inline style, so a committed resize must write the new size into BOTH the live style (visual)
 * and that snapshot (persistence) — otherwise it silently reverts on Save.
 *
 * Floors mirror AgentHtml's render-time clamp (MIN_CHART_W / MIN_CHART_H) so the next document rebuild
 * doesn't snap a user's size back up and fight them.
 */
export const MIN_EMBED_W = 320;
export const MIN_EMBED_H = 340;

export type ResizeDir = 'e' | 'w' | 's' | 'n' | 'se' | 'sw' | 'ne' | 'nw';

/** New width/height for a top-left-anchored box: east/south grow on positive drag, west/north on negative. */
export function resizeDelta(dir: ResizeDir, startW: number, startH: number, dx: number, dy: number): { width: number; height: number } {
  const growX = dir.includes('e') ? dx : dir.includes('w') ? -dx : 0;
  const growY = dir.includes('s') ? dy : dir.includes('n') ? -dy : 0;
  return { width: startW + growX, height: startH + growY };
}

/** Live (uncommitted) size preview during a drag — clamps to the floor but does NOT touch data-mx-osz. */
export function previewEmbedSize(el: HTMLElement, width: number, height: number): void {
  el.style.width = `${Math.max(Math.round(width), MIN_EMBED_W)}px`;
  el.style.height = `${Math.max(Math.round(height), MIN_EMBED_H)}px`;
}

/**
 * Make `el` a positioning context for absolutely-positioned resize handles (only if it has none),
 * returning a restore fn. Edit-time-only chrome: serialize restores data-mx-osz, so this never persists.
 */
export function ensurePositioned(el: HTMLElement): () => void {
  const prev = el.style.position;
  if (!prev) el.style.position = 'relative';
  return () => { el.style.position = prev; };
}

/** Set width/height on a `style` cssText string without disturbing the other authored declarations. */
function withSize(cssText: string, w: number, h: number): string {
  const probe = document.createElement('div');
  probe.style.cssText = cssText;
  probe.style.width = `${w}px`;
  probe.style.height = `${h}px`;
  return probe.style.cssText;
}

/**
 * Commit a pixel size onto a story embed placeholder: writes the clamped size to the live style (for
 * immediate render) AND into the `data-mx-osz` snapshot (so serialize-story round-trips it). Returns
 * the clamped size actually applied.
 */
export function applyEmbedResize(el: HTMLElement, width: number, height: number): { width: number; height: number } {
  const w = Math.max(Math.round(width), MIN_EMBED_W);
  const h = Math.max(Math.round(height), MIN_EMBED_H);
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  const osz = el.getAttribute('data-mx-osz');
  if (osz !== null) el.setAttribute('data-mx-osz', withSize(osz, w, h));
  return { width: w, height: h };
}
