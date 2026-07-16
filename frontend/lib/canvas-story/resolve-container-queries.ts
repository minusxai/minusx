/**
 * Resolve CSS `@container` rules at a fixed raster width: the raster lays the story
 * out at one known width, so container-query variants (Tailwind `@2xl:` etc.) can be
 * decided statically — unwrap matching blocks, drop non-matching ones. Takumi does
 * not evaluate container queries; without this, canvas falls back to base styles
 * (smaller headlines, single-column grids) while the DOM applies the variants.
 */
export function resolveContainerQueries(css: string, widthPx: number): string {
  let out = '';
  for (let i = 0; i < css.length; ) {
    const at = css.indexOf('@container', i);
    if (at === -1) { out += css.slice(i); break; }
    out += css.slice(i, at);
    const brace = css.indexOf('{', at);
    if (brace === -1) break;
    const condition = css.slice(at + '@container'.length, brace);
    let depth = 1;
    let j = brace + 1;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    const body = css.slice(brace + 1, j - 1);
    if (containerConditionMatches(condition, widthPx)) {
      out += resolveContainerQueries(body, widthPx);
    }
    i = j;
  }
  return out;
}

/** Supports `(min-width: Xpx|Xrem)` and range syntax `(width >= Xrem)` / `(width <= X)`. */
function containerConditionMatches(condition: string, widthPx: number): boolean {
  const toPx = (num: string, unit: string) => parseFloat(num) * (unit === 'rem' || unit === 'em' ? 16 : 1);
  const min = condition.match(/min-width:\s*([\d.]+)(px|rem|em)/);
  if (min) return widthPx >= toPx(min[1], min[2]);
  const max = condition.match(/max-width:\s*([\d.]+)(px|rem|em)/);
  if (max) return widthPx <= toPx(max[1], max[2]);
  const ge = condition.match(/width\s*>=\s*([\d.]+)(px|rem|em)/);
  if (ge) return widthPx >= toPx(ge[1], ge[2]);
  const gt = condition.match(/width\s*>\s*([\d.]+)(px|rem|em)/);
  if (gt) return widthPx > toPx(gt[1], gt[2]);
  const le = condition.match(/width\s*<=\s*([\d.]+)(px|rem|em)/);
  if (le) return widthPx <= toPx(le[1], le[2]);
  const lt = condition.match(/width\s*<\s*([\d.]+)(px|rem|em)/);
  if (lt) return widthPx < toPx(lt[1], lt[2]);
  return false; // unknown condition: safer to keep base styles
}
