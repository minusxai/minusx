/**
 * Static CSS-layout analysis for story bodies — the pure engine behind the story width rules.
 *
 * A story embed (`<Question>`) is always `width:100%` of its cell; its rendered width is set by
 * the CSS layout AROUND it. We can't resolve real pixels without a browser, but we CAN catch the
 * common structural causes of a cramped chart: a chart packed into a multi-column CSS grid, or
 * pinned to a fixed narrow px width. This module walks the agent-JSX body, resolves each embed's
 * approximate column-width share (grid-track division × percentage widths) and its tightest fixed
 * px cap, and collects param declarations/refs for the undeclared-param rule.
 *
 * Input is the AGENT JSX form (`buildStoryJsx`), where embeds are real `<Question>/<Number>/
 * <Param>` elements with inline `viz`/`params`/`style`, not the stored placeholder-div HTML.
 */
import { parseJsx } from '@/lib/jsx';
import type { JsonValue, JsxElement, JsxNode } from '@/lib/jsx';
import { extractSqlParams } from './shared';

/** Canonical subset of CSS declarations the width analyzer reads (from inline styles OR class rules). */
export interface CssDecls {
  display?: string;
  gridTemplateColumns?: string;
  width?: string;
  maxWidth?: string;
  flexBasis?: string;
  gridColumn?: string;
}

/** One `<Question>` embed with its resolved layout context. */
interface EmbedBox {
  vizType: string | null;   // inline `viz.type`; saved (`id`) embeds resolve type via ctx later
  savedId: number | null;   // `id={N}` for a saved embed, else null
  fraction: number;         // estimated share of the story column width, (0..1]
  minPx: number | null;     // tightest fixed px width/max-width on the path (or the embed itself)
}

/** An inline query's param usage: names it references vs names it declares locally (`params` prop). */
interface ParamRef { refs: string[]; local: string[] }

export interface StoryLayoutScan {
  embeds: EmbedBox[];
  declaredParams: string[];  // shared params declared via `<Param name=…>`
  paramRefs: ParamRef[];     // one per `<Question>`/`<Number>` with an inline query
}

// ── CSS value parsing ────────────────────────────────────────────────────────

/** Number of columns a `grid-template-columns` value produces; 0 when unknown (auto-fill/empty). */
export function gridTrackCount(value?: string): number {
  if (!value) return 0;
  const s = value.trim();
  if (!s) return 0;
  if (/\bauto-fill\b|\bauto-fit\b/.test(s)) return 0; // count depends on container width — unknowable statically
  const rep = /repeat\(\s*(\d+)\s*,/.exec(s);
  if (rep) return parseInt(rep[1], 10);
  // count top-level whitespace-separated tokens, treating parenthesised groups (minmax(…)) as atomic
  let depth = 0;
  let count = 0;
  let inTok = false;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0) {
      if (/\s/.test(ch)) inTok = false;
      else if (!inTok) { inTok = true; count++; }
    }
  }
  return count;
}

/** How many columns a grid item spans (from `grid-column`); defaults to 1. */
export function spanFromGridColumn(value?: string): number {
  if (!value) return 1;
  const span = /span\s+(\d+)/.exec(value);
  if (span) return Math.max(1, parseInt(span[1], 10));
  const range = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
  if (range) return Math.max(1, parseInt(range[2], 10) - parseInt(range[1], 10));
  return 1;
}

const CSS_KEY: Record<string, keyof CssDecls> = {
  display: 'display',
  gridtemplatecolumns: 'gridTemplateColumns',
  width: 'width',
  maxwidth: 'maxWidth',
  flexbasis: 'flexBasis',
  gridcolumn: 'gridColumn',
};
const normKey = (k: string) => k.replace(/-/g, '').toLowerCase();

function cssDeclsFromText(text: string): CssDecls {
  const out: CssDecls = {};
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const field = CSS_KEY[normKey(decl.slice(0, i).trim())];
    if (field) out[field] = decl.slice(i + 1).trim();
  }
  return out;
}

function cssDeclsFromStyleAttr(value: JsonValue | undefined): CssDecls {
  if (typeof value === 'string') return cssDeclsFromText(value); // HTML `style="…"` (kebab)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: CssDecls = {}; // JSX `style={{…}}` (camelCase)
    for (const [k, v] of Object.entries(value)) {
      const field = CSS_KEY[normKey(k)];
      if (field && typeof v === 'string') out[field] = v.trim();
    }
    return out;
  }
  return {};
}

/**
 * Parse the TOP-LEVEL class rules from a `<style>` block into `className → CssDecls`. At-rule
 * blocks (`@container`/`@media`/`@supports`/`@keyframes`) are stripped first: the base (desktop)
 * rule is what governs the widest layout, and the width rules judge the desktop composition, so a
 * narrow-width `@container` override that collapses to one column must NOT mask the base grid.
 */
export function parseTopLevelClassRules(css: string): Record<string, CssDecls> {
  const rules: Record<string, CssDecls> = {};
  const base = stripAtBlocks(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(base)) !== null) {
    const decls = cssDeclsFromText(m[2]);
    for (const sel of m[1].split(',')) {
      const subject = sel.trim().split(/\s+/).pop() ?? ''; // rightmost simple selector is the subject
      for (const cm of subject.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
        rules[cm[1]] = { ...(rules[cm[1]] ?? {}), ...decls }; // later rules win (approximates source order)
      }
    }
  }
  return rules;
}

/** Remove `@import …;` statements and balanced `@…{ … }` at-rule blocks, leaving base rules. */
function stripAtBlocks(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '@') {
      let j = i;
      while (j < css.length && css[j] !== '{' && css[j] !== ';') j++;
      if (css[j] === ';' || j >= css.length) { i = j + 1; continue; } // @import; (or truncated)
      let depth = 0;
      let k = j;
      for (; k < css.length; k++) {
        if (css[k] === '{') depth++;
        else if (css[k] === '}') { depth--; if (depth === 0) { k++; break; } }
      }
      i = k;
      continue;
    }
    out += css[i++];
  }
  return out;
}

// ── walk ─────────────────────────────────────────────────────────────────────

function attrJson(el: JsxElement, name: string): JsonValue | undefined {
  const a = el.attributes.find((x) => x.name === name);
  return a && a.value.static ? a.value.json : undefined;
}

function classNames(el: JsxElement): string[] {
  const v = attrJson(el, 'className') ?? attrJson(el, 'class');
  return typeof v === 'string' ? v.split(/\s+/).filter(Boolean) : [];
}

function mergedDecls(el: JsxElement, cssRules: Record<string, CssDecls>): CssDecls {
  const out: CssDecls = {};
  for (const c of classNames(el)) Object.assign(out, cssRules[c] ?? {});
  Object.assign(out, cssDeclsFromStyleAttr(attrJson(el, 'style'))); // inline style wins over classes
  return out;
}

const asPx = (v?: string): number | null => { const m = /^(-?\d+(?:\.\d+)?)px$/.exec((v ?? '').trim()); return m ? parseFloat(m[1]) : null; };
const asPct = (v?: string): number | null => { const m = /^(-?\d+(?:\.\d+)?)%$/.exec((v ?? '').trim()); return m ? parseFloat(m[1]) : null; };

function recordParamRef(el: JsxElement, scan: StoryLayoutScan): void {
  const q = attrJson(el, 'query');
  if (typeof q !== 'string') return;
  const refs = extractSqlParams(q);
  if (refs.length === 0) return;
  const params = attrJson(el, 'params');
  const local = Array.isArray(params)
    ? params.map((p) => (p && typeof p === 'object' && !Array.isArray(p) && typeof (p as Record<string, unknown>).name === 'string' ? String((p as Record<string, unknown>).name) : '')).filter(Boolean)
    : [];
  scan.paramRefs.push({ refs, local });
}

/**
 * Walk the agent-JSX story body, resolving each embed's column-width share and fixed-px caps, plus
 * the story's param declarations/references. `cssRules` comes from {@link parseTopLevelClassRules}.
 */
export function scanStoryLayout(bodyJsx: string, cssRules: Record<string, CssDecls>): StoryLayoutScan {
  const scan: StoryLayoutScan = { embeds: [], declaredParams: [], paramRefs: [] };
  const parsed = parseJsx(bodyJsx);
  if (!parsed.ok) return scan;

  const visit = (node: JsxNode, fraction: number, minPx: number | null, parentTracks: number): void => {
    if (node.type !== 'element') return;
    const el = node;
    const decls = mergedDecls(el, cssRules);

    // This element is a grid item of its parent: it gets span/tracks of the parent's width.
    let frac = fraction;
    let mp = minPx;
    if (parentTracks > 1) {
      const span = Math.min(spanFromGridColumn(decls.gridColumn), parentTracks);
      frac = (frac * span) / parentTracks;
    }
    // The element's own width constraints narrow it (and everything inside it) further.
    for (const w of [decls.width, decls.flexBasis, decls.maxWidth]) {
      const pct = asPct(w);
      const px = asPx(w);
      if (pct !== null) frac *= pct / 100;
      if (px !== null) mp = mp === null ? px : Math.min(mp, px);
    }

    if (el.tag === 'Question') {
      const viz = attrJson(el, 'viz');
      const vizType = viz && typeof viz === 'object' && !Array.isArray(viz) && typeof (viz as Record<string, unknown>).type === 'string'
        ? String((viz as Record<string, unknown>).type) : null;
      const idv = attrJson(el, 'id');
      scan.embeds.push({ vizType, savedId: typeof idv === 'number' ? idv : null, fraction: frac, minPx: mp });
      recordParamRef(el, scan);
    } else if (el.tag === 'Number') {
      recordParamRef(el, scan);
    } else if (el.tag === 'Param') {
      const n = attrJson(el, 'name');
      if (typeof n === 'string') scan.declaredParams.push(n);
    }

    // Columns THIS element establishes for its direct children.
    const childTracks = decls.gridTemplateColumns ? gridTrackCount(decls.gridTemplateColumns) : 1;
    for (const c of el.children) visit(c, frac, mp, childTracks);
  };

  for (const n of parsed.nodes) visit(n, 1, null, 1);
  return scan;
}
