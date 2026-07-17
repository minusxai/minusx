/**
 * Resolve CSS `@container` rules at a fixed raster width: the raster lays the story
 * out at one known width, so container-query variants (Tailwind `@2xl:` etc.) can be
 * decided statically — unwrap matching blocks, drop non-matching ones. Takumi does
 * not evaluate container queries; without this, canvas falls back to base styles
 * (smaller headlines, single-column grids) while the DOM applies the variants.
 *
 * Both emission forms are handled:
 *   classic — `@container (cond) { .sel { decls } }`
 *   nested  — `.sel { @container (cond) { decls } }`   (Tailwind v4 compiledCss)
 *
 * Unwrapped rules are scoped to DESCENDANTS of the `.@container` element: a real
 * `@container` query matches an element's ANCESTOR container, so a variant class on
 * the container element itself (the story root's own `@2xl:px-12`) never applies in
 * the DOM — the static resolution must not apply it either.
 */

interface CssChunk {
  /** Text before a block, or trailing loose text (declarations/statements). */
  prelude: string;
  /** Block body, or null when this chunk is loose text with no block. */
  body: string | null;
}

/** Split CSS into top-level chunks of `prelude { body }`, brace-balanced. */
function parseChunks(css: string): CssChunk[] {
  const chunks: CssChunk[] = [];
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    if (brace === -1) {
      const rest = css.slice(i);
      if (rest.trim()) chunks.push({ prelude: rest, body: null });
      break;
    }
    // loose statements (e.g. `@import …;`) before the selector stay attached
    let selStart = i;
    const semi = css.lastIndexOf(';', brace);
    if (semi > i) {
      chunks.push({ prelude: css.slice(i, semi + 1), body: null });
      selStart = semi + 1;
    }
    let depth = 1;
    let j = brace + 1;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    chunks.push({ prelude: css.slice(selStart, brace), body: css.slice(brace + 1, j - 1) });
    i = j;
  }
  return chunks;
}

const scopeSelector = (sel: string): string =>
  sel.split(',').map(s => `.\\@container ${s.trim()}`).join(', ');

export function resolveContainerQueries(css: string, widthPx: number): string {
  let out = '';
  for (const { prelude, body } of parseChunks(css)) {
    if (body === null) { out += prelude; continue; }
    const p = prelude.trim();
    if (p.startsWith('@container')) {
      // classic form: body holds rules for container descendants
      if (containerConditionMatches(p.slice('@container'.length), widthPx)) {
        for (const inner of parseChunks(resolveContainerQueries(body, widthPx))) {
          out += inner.body === null ? inner.prelude : `${scopeSelector(inner.prelude)}{${inner.body}}`;
        }
      }
    } else if (p.startsWith('@')) {
      // other at-rule (@media, @layer, @supports): keep, resolve inside
      out += `${prelude}{${resolveContainerQueries(body, widthPx)}}`;
    } else {
      out += resolveRuleWithNestedQueries(prelude, body, widthPx);
    }
  }
  return out;
}

/** Nested form: `.sel { decls; @container (cond) { decls } }`. */
function resolveRuleWithNestedQueries(selector: string, body: string, widthPx: number): string {
  if (!body.includes('@container')) return `${selector}{${body}}`;
  let plain = '';
  let scoped = '';
  for (const { prelude, body: inner } of parseChunks(body)) {
    const p = prelude.trim();
    if (inner !== null && p.startsWith('@container')) {
      if (containerConditionMatches(p.slice('@container'.length), widthPx)) {
        scoped += `${scopeSelector(selector)}{${inner}}`;
      }
    } else {
      plain += inner === null ? prelude : `${prelude}{${inner}}`;
    }
  }
  return `${selector}{${plain}}${scoped}`;
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
