/**
 * Shared-tooltip GUIDE LINE injection (Viz Arch V2).
 *
 * The ECharts-style axis tooltip draws a vertical guide line at the hovered x. It's a
 * native Vega `rule` mark injected BEHIND the data marks (so bars occlude it) and driven
 * by signals — NOT a DOM overlay — so it lands exactly on the data-rect pixel and clips
 * to the plot. Injected into the COMPILED vega spec (after vega-lite compile, before
 * parse) by <VegaChart>; the pointer handler there toggles the signals.
 *
 * Signals:
 *   mxGuidePx      — data-rect pixel x of the guide (same space as the marks). -1 = off-canvas.
 *   mxGuideOn      — 0/1 visibility toggle (drives opacity).
 *   mxGuideH       — the guide's height in px. Rests at 0; set to the plot height on hover.
 *   mxGuideW       — the guide's stroke width in px. Rests at the thin-line default; VegaChart
 *                    widens it to the x-scale BAND width on hover for bar/band charts, so the
 *                    guide fills the whole category slot (an ECharts `axisPointer: 'shadow'`).
 *                    Line/area/scatter keep the thin default (their x scale has no bandwidth).
 *   mxGuideOpacity — the guide's fill opacity. Rests at the thin-line default; softened for the
 *                    wide band so a full-slot fill doesn't overpower the bars.
 *
 * Why mxGuideH instead of `y2: {signal: 'height'}`: bounds hygiene under the render-time
 * `autosize: {type: 'fit', contains: 'padding'}`. The fit solve accounts every mark's
 * bounds — an invisible rule spanning the full plot height (at x=-1, no less) has no
 * business contributing to that math. Resting at 0 keeps the guide's bounds empty until
 * the user hovers, when the layout is already settled and the real plot height is known
 * (VegaChart passes it via the signal).
 */

// A subtle grey band. Tune stroke/width/opacity here.
export const GUIDE_STROKE = '#9aa4b2';
export const GUIDE_WIDTH = 5;
export const GUIDE_OPACITY = 0.28;
// Wide (band) guide for bar charts: a full-slot fill needs a softer opacity than the thin line.
export const GUIDE_BAND_OPACITY = 0.16;

/**
 * Prepend the guide rule + its signals to a compiled vega spec. Returns false (a no-op)
 * for composed/empty specs whose top-level `marks` isn't a plain array to unshift into.
 */
export function injectGuideMark(vegaSpec: Record<string, unknown>): boolean {
  const marks = vegaSpec.marks;
  if (!Array.isArray(marks) || marks.length === 0) return false; // composed/empty → no guide
  const signals = (Array.isArray(vegaSpec.signals) ? vegaSpec.signals : []) as Array<Record<string, unknown>>;
  signals.push(
    { name: 'mxGuidePx', value: -1 },
    { name: 'mxGuideOn', value: 0 },
    { name: 'mxGuideH', value: 0 },
    { name: 'mxGuideW', value: GUIDE_WIDTH },
    { name: 'mxGuideOpacity', value: GUIDE_OPACITY },
  );
  vegaSpec.signals = signals;
  marks.unshift({
    type: 'rule', interactive: false, clip: true,
    encode: { update: {
      // y2 reads mxGuideH (rest 0), not the `height` signal — the hidden guide must
      // contribute zero bounds to the autosize:fit solve (see the module doc).
      x: { signal: 'mxGuidePx' }, y: { value: 0 }, y2: { signal: 'mxGuideH' },
      stroke: { value: GUIDE_STROKE },
      // width/opacity are signal-driven so VegaChart can grow the guide to the full band
      // width (bars) on hover while line/area keep the thin resting default.
      strokeWidth: { signal: 'mxGuideW' },
      opacity: { signal: 'mxGuideOn * mxGuideOpacity' },
    } },
  });
  return true;
}
