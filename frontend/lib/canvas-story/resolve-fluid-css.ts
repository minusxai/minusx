/**
 * Statically resolve fluid-typography CSS the takumi wasm engine rejects: container
 * units (`cqi`/`cqw` — 1% of the container inline size ≈ the raster width) and
 * `clamp()/min()/max()` expressions. One unsupported declaration aborts takumi's
 * whole render, so a single `font-size: clamp(...)` would otherwise silently push
 * the entire story to the DOM fallback.
 *
 * Resolution happens at the KNOWN raster width, mirroring resolveContainerQueries:
 * absolute-resolvable args (px, rem, cqi/cqw — already converted) are computed
 * numerically; if any arg is unresolvable (em, %), the function collapses to its
 * preferred value (middle arg for clamp, first for min/max).
 */

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Parse an argument to px, or null when it cannot be resolved statically. */
function argToPx(arg: string): number | null {
  const m = arg.trim().match(/^(-?\d*\.?\d+)(px|rem)$/);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] === 'rem' ? 16 : 1);
}

/** Split a function's argument list on top-level commas. */
function splitArgs(body: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += ch;
  }
  args.push(cur);
  return args.map(a => a.trim());
}

function resolveFn(name: string, body: string): string {
  const args = splitArgs(body);
  const px = args.map(argToPx);
  if (name === 'clamp' && args.length === 3) {
    const [lo, pref, hi] = px;
    if (lo !== null && pref !== null && hi !== null) return `${round(Math.min(Math.max(pref, lo), hi))}px`;
    return args[1]; // preferred value
  }
  if ((name === 'min' || name === 'max') && args.length >= 1) {
    if (px.every((v): v is number => v !== null)) {
      return `${round(name === 'min' ? Math.min(...(px as number[])) : Math.max(...(px as number[])))}px`;
    }
    return args[0];
  }
  return `${name}(${body})`;
}

export function resolveFluidCss(css: string, widthPx: number): string {
  // 1. container units → px at the raster width (before evaluating functions).
  let out = css.replace(/(-?\d*\.?\d+)(cqi|cqw)\b/g, (_, n: string) => `${round(parseFloat(n) * widthPx / 100)}px`);
  // 2. clamp()/min()/max() → concrete value. Innermost-first so nesting resolves.
  const fnRe = /\b(clamp|min|max)\(([^()]*)\)/g;
  for (let i = 0; i < 8 && fnRe.test(out); i++) {
    out = out.replace(fnRe, (_, name: string, body: string) => resolveFn(name, body));
    fnRe.lastIndex = 0;
  }
  return out;
}
