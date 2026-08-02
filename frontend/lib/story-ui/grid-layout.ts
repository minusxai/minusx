/**
 * Pure geometry for the story `<Grid>`/`<GridItem>` components — no React, no DOM, so both
 * the kit components and the edit-mode adapter share ONE defaulting/clamping rule and the
 * write-back diff is unit-testable in isolation.
 *
 * The model mirrors the dashboard's rhythm with react-grid-layout margins folded in:
 * 12 columns, 86px rows (the dashboard's 80px rowHeight + 6px margin), and the visual
 * gutter as padding INSIDE each item — so edit-mode RGL (margin [0,0]) and the view-mode
 * percentage CSS place items with identical arithmetic.
 */

export interface GridItemRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A layout edit destined for `applyLayoutEditsToJsx` — keyed by the item's AST path. */
export interface GridLayoutEdit extends GridItemRect {
  astPath: string;
}

export const GRID_DEFAULT_COLS = 12;
/** Row height in px — dashboard's 80px rowHeight + 6px margin, folded (see module doc). */
export const GRID_DEFAULT_ROW_HEIGHT = 86;

/** Sanitize the authored `cols` prop: integer, clamped to [1, 24]; default 12. */
export function gridCols(value: unknown): number {
  throw new Error('not implemented');
}

/** Sanitize the authored `rowHeight` prop: integer px, clamped to [20, 400]; default 86. */
export function gridRowHeight(value: unknown): number {
  throw new Error('not implemented');
}

/**
 * The single defaulting/clamping rule for a GridItem's rect, applied identically by the
 * view-mode CSS component and the edit-mode RGL adapter:
 * defaults x=0, y=0, w=6, h=4; integers; 1 ≤ w ≤ cols; h ≥ 1; 0 ≤ x ≤ cols−w; y ≥ 0.
 */
export function gridItemRect(
  props: { x?: unknown; y?: unknown; w?: unknown; h?: unknown },
  cols: number,
): GridItemRect {
  throw new Error('not implemented');
}

/** Total rows the grid spans — max(y+h) over items, minimum 1 (an empty grid keeps one row). */
export function gridRows(rects: GridItemRect[]): number {
  throw new Error('not implemented');
}

/**
 * Diff react-grid-layout's post-drag layout against the items' current rects (keyed by AST
 * path — the RGL item key IS the path). Returns an edit per CHANGED item only, so opening
 * edit mode or an RGL mount-echo never commits anything. Unknown keys are skipped.
 */
export function diffLayouts(
  next: readonly { i: string; x: number; y: number; w: number; h: number }[],
  current: ReadonlyMap<string, GridItemRect>,
): GridLayoutEdit[] {
  throw new Error('not implemented');
}
