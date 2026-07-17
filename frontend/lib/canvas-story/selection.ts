import type { StoryTextRun } from '@/lib/canvas-story/types';

/**
 * Canvas text selection — the pure geometry/text model.
 *
 * Selection state is a pair of (run index, character offset) points over the raster's
 * measured text runs (document order). Everything here is pure math over that state:
 * hit-testing the pointer to a run, word expansion, highlight band geometry, and the
 * clipboard text. All coordinates are CSS px in story space (same space as the runs).
 */

export interface SelectionPoint {
  /** Index into the raster's runs array. */
  run: number;
  /** Character offset within that run's text. */
  offset: number;
}

export interface RunSelection { a: SelectionPoint; b: SelectionPoint }

export interface SelectionBand { x: number; y: number; w: number; h: number }

/** Nearest run to (x, y), with the offset proportional to x within the run. */
export function locatePoint(runs: StoryTextRun[], x: number, y: number): SelectionPoint | null {
  let best = -1;
  let bestD = Infinity;
  runs.forEach((r, i) => {
    const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - (r.y + r.h) : 0;
    const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
    const d = dy * 4 + dx; // vertical misses cost more: favors the run on the same line
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best < 0) return null;
  const r = runs[best];
  const frac = Math.min(1, Math.max(0, (x - r.x) / Math.max(1, r.w)));
  return { run: best, offset: Math.round(frac * r.text.length) };
}

const WORD_CHAR = /[\w$%.,'’-]/;

/** Word selection around a point (double-click); null when the point is not on a word. */
export function wordAt(runs: StoryTextRun[], p: SelectionPoint): RunSelection | null {
  const t = runs[p.run]?.text ?? '';
  let a = Math.min(p.offset, t.length - 1);
  if (!WORD_CHAR.test(t[a] ?? '')) return null;
  let b = a;
  while (a > 0 && WORD_CHAR.test(t[a - 1])) a--;
  while (b < t.length && WORD_CHAR.test(t[b])) b++;
  return { a: { run: p.run, offset: a }, b: { run: p.run, offset: b } };
}

function ordered(sel: RunSelection): [SelectionPoint, SelectionPoint] {
  const { a, b } = sel;
  return a.run < b.run || (a.run === b.run && a.offset <= b.offset) ? [a, b] : [b, a];
}

/**
 * Highlight bands for a selection: partial coverage on the endpoint runs, full runs
 * between, and each band extended down to the next selected line's top within the
 * same block — so multi-line selections have no gaps in the leading, like ::selection.
 */
export function selectionBands(runs: StoryTextRun[], sel: RunSelection): SelectionBand[] {
  const [lo, hi] = ordered(sel);
  const bands: SelectionBand[] = [];
  for (let i = lo.run; i <= hi.run && i < runs.length; i++) {
    const r = runs[i];
    let x0 = r.x;
    let x1 = r.x + r.w;
    if (i === lo.run) x0 = r.x + (lo.offset / Math.max(1, r.text.length)) * r.w;
    if (i === hi.run) x1 = r.x + (hi.offset / Math.max(1, r.text.length)) * r.w;
    if (x1 <= x0) continue;
    let h = r.h;
    for (let j = i + 1; j <= hi.run && j < runs.length; j++) {
      const n = runs[j];
      if (n.block !== r.block) break;
      if (n.y > r.y + 1) { h = Math.min(n.y - r.y, r.h * 1.6); break; }
    }
    bands.push({ x: x0, y: r.y, w: x1 - x0, h });
  }
  return bands;
}

/** The selected text: same-block line wraps join with a space, block changes with \n. */
export function selectionText(runs: StoryTextRun[], sel: RunSelection): string {
  const [lo, hi] = ordered(sel);
  let out = '';
  let prev: StoryTextRun | null = null;
  for (let i = lo.run; i <= hi.run && i < runs.length; i++) {
    const r = runs[i];
    let t = r.text;
    if (i === hi.run) t = t.slice(0, hi.offset);
    if (i === lo.run) t = t.slice(lo.offset);
    if (prev) out += prev.block !== r.block && Math.abs(r.y - prev.y) > 2 ? '\n' : (out.endsWith(' ') || t.startsWith(' ') ? '' : ' ');
    out += t;
    prev = r;
  }
  return out.replace(/ {2,}/g, ' ').replace(/[ \t]+\n/g, '\n');
}
