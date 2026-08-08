/**
 * Top-level Vega-Lite facet layout math — pure spec/row arithmetic, no vega
 * imports, so surfaces that only need to SIZE a facet container (notebook
 * cells) can use it without pulling the render engines into their bundle.
 * The render pipeline (render-vega.ts) composes computeFacetLayoutPlan into
 * every view build.
 */

/**
 * Render-time dimensions for a top-level Vega-Lite facet. Facets compile their
 * plot dimensions to `child_width` / `child_height`, not the root `width` /
 * `height` signals unit charts use, so the view sizing path needs this separate
 * contract. Missing child dimensions mean the author supplied that dimension
 * explicitly and the renderer must leave it alone.
 */
export interface FacetLayoutPlan {
  childWidth?: number;
  childHeight?: number;
  columns: number;
  rows: number;
}

const FACET_DEFAULT_SPACING = 20;
// A facet child dimension is the DATA rectangle only. Per-column axes/header
// labels and the view's export padding sit outside it; reserve those before
// dividing the container so the complete SVG, not just its plots, stays bounded.
const FACET_OUTER_HORIZONTAL_PADDING_PX = 24;
const FACET_OUTER_VERTICAL_PADDING_PX = 10;
const FACET_COLUMN_CHROME_PX = 24;
// Theme legend + facet title/header consume ~90px before per-row x-axis chrome.
const FACET_SHARED_VERTICAL_CHROME_PX = 90;
const FACET_ROW_CHROME_PX = 40;
const FACET_MIN_CHILD_PX = 40;
// Preferred data-rectangle height per panel when the container is free to grow
// (a notebook cell) rather than fixed (a dashboard tile).
const FACET_PREFERRED_CHILD_PX = 120;

export const record = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const distinctFacetValues = (
  def: Record<string, unknown> | null,
  rows: Record<string, unknown>[],
): number => {
  const field = def?.field;
  if (typeof field !== 'string') return 1;
  const values: unknown[] = [];
  for (const row of rows) {
    const value = row[field];
    if (value != null && !values.includes(value)) values.push(value);
  }
  if (values.length > 0) return values.length;
  // A transformed facet field may not exist in the raw rows. An authored sort
  // array still gives us the intended cardinality; otherwise retain one safe cell.
  const sort = def?.sort;
  return Array.isArray(sort) && sort.length > 0 ? sort.length : 1;
};

const facetSpacing = (spec: Record<string, unknown>, axis: 'row' | 'column'): number => {
  const spacing = spec.spacing;
  if (typeof spacing === 'number' && Number.isFinite(spacing)) return Math.max(0, spacing);
  const perAxis = record(spacing)?.[axis];
  return typeof perAxis === 'number' && Number.isFinite(perAxis)
    ? Math.max(0, perAxis)
    : FACET_DEFAULT_SPACING;
};

// Safe-side advance width per label character: the house mono runs 6.6px at the
// 11px label size (the legend planner's basis in render-vega.ts), but headless
// renders measure with fallback fonts that run wider. Over-reserving narrows a
// panel slightly; under-reserving clips the rightmost panel entirely.
const AXIS_LABEL_CHAR_PX = 7.2;
const AXIS_LABEL_LIMIT_PX = 180; // Vega-Lite's default labelLimit — labels truncate past this
// Tick + label padding + rotated axis title, plus slack for value-label text
// marks protruding past the last panel's max bar.
const Y_AXIS_TICK_TITLE_PX = 40;

/** The y channel def of the child (unit encoding, or the first among layers). */
const findYDef = (spec: Record<string, unknown>): Record<string, unknown> | null => {
  const y = record(record(spec.encoding)?.y);
  if (y) return y;
  const layers = spec.layer;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      const l = record(layer);
      const found = l ? findYDef(l) : null;
      if (found) return found;
    }
  }
  return null;
};

/**
 * Width of a panel's y-axis label gutter, which Vega-Lite draws OUTSIDE
 * child_width. Only nominal/ordinal y axes are estimated (horizontal-bar
 * category labels come from the data and can be arbitrarily long); the short
 * numeric/temporal labels stay covered by FACET_COLUMN_CHROME_PX.
 */
const yLabelGutterPx = (
  child: Record<string, unknown>,
  rows: Record<string, unknown>[],
): number => {
  const y = findYDef(child);
  if (!y || typeof y.field !== 'string') return 0;
  if (y.type !== 'nominal' && y.type !== 'ordinal') return 0;
  let maxLen = 0;
  for (const row of rows) {
    const value = row[y.field];
    if (value != null) maxLen = Math.max(maxLen, String(value).length);
  }
  if (maxLen === 0) return 0;
  return Math.min(Math.ceil(maxLen * AXIS_LABEL_CHAR_PX), AXIS_LABEL_LIMIT_PX) + Y_AXIS_TICK_TITLE_PX;
};

/** Grid shape (panel columns × rows) of a top-level facet against real rows. */
const facetGridShape = (
  facet: Record<string, unknown>,
  spec: Record<string, unknown>,
  rows: Record<string, unknown>[],
): { columns: number; rows: number } => {
  if (typeof facet.field === 'string') {
    const count = distinctFacetValues(facet, rows);
    const authoredColumns = typeof spec.columns === 'number' && Number.isFinite(spec.columns)
      ? Math.max(1, Math.floor(spec.columns))
      : count;
    const columns = Math.min(authoredColumns, count);
    return { columns, rows: Math.ceil(count / columns) };
  }
  return {
    columns: distinctFacetValues(record(facet.column), rows),
    rows: distinctFacetValues(record(facet.row), rows),
  };
};

/** Plan a top-level facet inside the given outer container. */
export function computeFacetLayoutPlan(
  spec: Record<string, unknown>,
  rows: Record<string, unknown>[],
  containerWidth: number,
  containerHeight: number,
): FacetLayoutPlan | null {
  const facet = record(spec.facet);
  const child = record(spec.spec);
  if (!facet || !child) return null;

  const shape = facetGridShape(facet, spec, rows);
  const { columns, rows: rowCount } = shape;

  const plan: FacetLayoutPlan = { columns, rows: rowCount };
  if (!Object.prototype.hasOwnProperty.call(child, 'width')) {
    const gap = facetSpacing(spec, 'column') * Math.max(0, columns - 1);
    // Independent y scales repeat the label gutter in EVERY column; a shared
    // scale draws it once at the left of the grid.
    const yGutter = yLabelGutterPx(child, rows);
    const yIndependent = record(record(spec.resolve)?.scale)?.y === 'independent';
    plan.childWidth = Math.max(
      FACET_MIN_CHILD_PX,
      Math.floor((Math.max(containerWidth, 80) - FACET_OUTER_HORIZONTAL_PADDING_PX - gap
        - (yIndependent ? 0 : yGutter)) / columns
        - FACET_COLUMN_CHROME_PX - (yIndependent ? yGutter : 0)),
    );
  }
  if (!Object.prototype.hasOwnProperty.call(child, 'height')) {
    const gap = facetSpacing(spec, 'row') * Math.max(0, rowCount - 1);
    plan.childHeight = Math.max(
      FACET_MIN_CHILD_PX,
      Math.floor((Math.max(containerHeight, 60) - FACET_OUTER_VERTICAL_PADDING_PX - gap
        - FACET_SHARED_VERTICAL_CHROME_PX) / rowCount - FACET_ROW_CHROME_PX),
    );
  }
  return plan;
}

/**
 * Natural container height for a top-level facet: the height at which
 * computeFacetLayoutPlan hands every panel ~FACET_PREFERRED_CHILD_PX of data
 * rectangle (or honors an authored child height) instead of squeezing rows
 * toward FACET_MIN_CHILD_PX and clipping. Surfaces whose height is free to
 * grow (notebook cells) size their chart container with this; fixed surfaces
 * (dashboard tiles) ignore it. Null for non-facet specs.
 */
export function facetPreferredHeight(
  spec: Record<string, unknown>,
  rows: Record<string, unknown>[],
): number | null {
  const facet = record(spec.facet);
  const child = record(spec.spec);
  if (!facet || !child) return null;

  const shape = facetGridShape(facet, spec, rows);
  const childHeight = typeof child.height === 'number' && Number.isFinite(child.height)
    ? child.height
    : FACET_PREFERRED_CHILD_PX;
  const gap = facetSpacing(spec, 'row') * Math.max(0, shape.rows - 1);
  return Math.ceil(
    shape.rows * (childHeight + FACET_ROW_CHROME_PX)
      + gap + FACET_SHARED_VERTICAL_CHROME_PX + FACET_OUTER_VERTICAL_PADDING_PX,
  );
}
