/**
 * Chart color tokens (Story_Design_V2 §5): the shadcn `--chart-1..5` CSS variables drive the
 * Vega categorical color range. Resolved from COMPUTED style at render time, so a chart picks
 * up whatever `[data-theme]` scope (or `:root` default block) surrounds its container — no
 * theme plumbing through the embed chain. Outside a token scope (dashboards, questions) the
 * vars are undefined and the house palette stays in charge (`chartTokenRange` → null).
 */

export const CHART_TOKEN_NAMES = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'] as const;

/**
 * Map the five chart tokens to a Vega categorical range. Pure (testable): `read` returns a
 * custom property's computed value ('' when undefined). Returns null unless `--chart-1` is
 * defined (no token scope → keep the default palette); otherwise the defined tokens in order,
 * skipping any empty slots.
 */
export function chartTokenRange(read: (name: string) => string): string[] | null {
  const values = CHART_TOKEN_NAMES.map(n => (read(n) ?? '').trim());
  if (!values[0]) return null;
  return values.filter(v => v !== '');
}

/** DOM wrapper: resolve the chart tokens from an element's computed style (its own document's view). */
export function chartTokenRangeFromElement(el: Element): string[] | null {
  const win = el.ownerDocument?.defaultView;
  if (!win) return null;
  const cs = win.getComputedStyle(el);
  return chartTokenRange(name => cs.getPropertyValue(name));
}
