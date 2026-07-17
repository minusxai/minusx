import { fromHtml } from '@takumi-rs/helpers/html';
import { EMBED_DEFAULT_SIZE, StoryEmbedKind } from '@/lib/canvas-story/types';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { resolveFluidCss } from '@/lib/canvas-story/resolve-fluid-css';

/**
 * Build a takumi node tree from story HTML, applying the transforms the raster
 * pipeline needs (learned in the parity harness — see canvas-arch.md §4.7):
 *
 * 1. Entity decoding: takumi's fromHtml does not decode HTML entities.
 * 2. Bare-text blocks emit no measured text runs. Block-level text is wrapped in an
 *    inner container so runs attach to a node whose transform IS the content-box
 *    origin (padding-exact geometry for arbitrary CSS). Inline elements are left
 *    in native text-node form so the parent block owns all runs in visual order.
 * 3. Embed placeholders (`data-question-id` etc.) get reserved default sizes so
 *    layout leaves room for the live embed islands mounted over them.
 */

const INLINE_TAGS = immutableSet(['span', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'small', 'sub', 'sup', 'mark', 'abbr']);

// Non-content elements whose text must never become runs (a <title> would emit a
// phantom run of the whole heading that hijacks selection hit-testing).
const NON_CONTENT_TAGS = immutableSet(['title', 'script', 'style', 'head', 'meta', 'link', 'noscript', 'template']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', middot: '·', bull: '•', times: '×',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

interface RawNode {
  type: string;
  text?: string;
  tagName?: string;
  className?: string;
  style?: Record<string, unknown>;
  attributes?: Record<string, string>;
  children?: RawNode[];
  [key: string]: unknown;
}

export const EMBED_ATTRS: Array<{ attr: string; kind: StoryEmbedKind }> = [
  { attr: 'data-question-id', kind: 'question' },
  { attr: 'data-question-inline', kind: 'question-inline' },
  { attr: 'data-number-inline', kind: 'number-inline' },
  { attr: 'data-param-name', kind: 'param' },
];

export function embedKindOf(node: { attributes?: Record<string, string> } | null | undefined): { kind: StoryEmbedKind; ref: string } | null {
  const attrs = node?.attributes;
  if (!attrs) return null;
  for (const { attr, kind } of EMBED_ATTRS) {
    if (attr in attrs) return { kind, ref: attrs[attr] ?? '' };
  }
  return null;
}

/** takumi renders no ::marker — inject bullet/number text into list items.
 *  ONLY for lists that opt back in (`list-disc`/`list-decimal` class or an inline
 *  list-style): Tailwind's preflight sets `list-style: none` on all lists, so the
 *  DOM shows no markers by default — unconditional injection double-marked lists
 *  that carry their own dashes/numbering in text. */
function injectListMarkers(node: RawNode): void {
  if (node.tagName !== 'ul' && node.tagName !== 'ol') return;
  const cls = node.className ?? '';
  const inlineStyle = String(node.style?.listStyle ?? node.style?.listStyleType ?? '');
  const wantsMarkers = /\blist-(disc|decimal)\b/.test(cls) || /(disc|decimal)/.test(inlineStyle);
  if (!wantsMarkers) return;
  node.style = { paddingLeft: 24, ...(node.style ?? {}) };
  let n = 0;
  for (const child of node.children ?? []) {
    if (child.tagName !== 'li') continue;
    const marker = node.tagName === 'ol' ? `${++n}. ` : '\u2022 ';
    if (child.type === 'text' && typeof child.text === 'string') {
      child.text = marker + child.text;
    } else {
      child.children = [{ type: 'text', text: marker }, ...(child.children ?? [])];
    }
  }
}

interface TransformState {
  embedIndex: number;
  embedSizes?: Record<number, { width: number; height: number }>;
  /** Raster width — resolves fluid values (clamp/cqi) in INLINE styles. */
  width: number;
}

/** Inline style values takumi rejects hard-fail the WHOLE raster — sanitize them:
 *  fluid functions/container units resolve at the known width (like the stylesheet
 *  pipeline), and overflow `auto`/`scroll` map to `hidden` (a raster cannot scroll;
 *  clipping matches what a capture of the DOM would show). */
function resolveFluidStyle(node: RawNode, width: number): void {
  if (!node.style) return;
  for (const [k, v] of Object.entries(node.style)) {
    if (typeof v !== 'string') continue;
    let value = v;
    if (/\b(?:clamp|min|max)\(|\dcq[iw]\b/.test(value)) value = resolveFluidCss(value, width);
    if (/^overflow/.test(k) && /^(auto|scroll)$/.test(value.trim())) value = 'hidden';
    if (value !== v) node.style[k] = value;
  }
}

/** Strip a property (by css/camelCase name) from every node — the retry path for
 *  inline values takumi rejects that we have no better mapping for. */
export function stripStyleProp(node: { style?: Record<string, unknown>; children?: unknown[] }, prop: string): void {
  const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  if (node.style && camel in node.style) delete node.style[camel];
  for (const child of node.children ?? []) stripStyleProp(child as { style?: Record<string, unknown>; children?: unknown[] }, prop);
}

/** takumi has no table layout (flex/grid/block only) — real <table> markup would
 *  collapse to stacked blocks, vertically exploding KPI grids. Emulate with flex:
 *  rows become flex rows, cells share the width equally (colSpan-weighted). */
function emulateTableLayout(node: RawNode): void {
  const tag = node.tagName;
  if (tag === 'table') {
    node.style = { width: '100%', ...(node.style ?? {}), display: 'block' };
  } else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
    node.style = { ...(node.style ?? {}), display: 'block', width: '100%' };
  } else if (tag === 'tr') {
    node.style = { width: '100%', ...(node.style ?? {}), display: 'flex', flexDirection: 'row' };
  } else if (tag === 'td' || tag === 'th') {
    const span = parseInt(node.attributes?.colspan ?? '1', 10) || 1;
    node.style = { minWidth: 0, ...(node.style ?? {}), flexGrow: span, flexBasis: 0 };
  }
}

function transform(node: RawNode, state: TransformState): RawNode {
  injectListMarkers(node);
  emulateTableLayout(node);
  resolveFluidStyle(node, state.width);
  const embed = embedKindOf(node);
  if (embed) {
    const idx = state.embedIndex++;
    const override = state.embedSizes?.[idx];
    const size = EMBED_DEFAULT_SIZE[embed.kind];
    const inline = embed.kind === 'number-inline' || embed.kind === 'param';
    node.style = {
      ...(node.style ?? {}),
      width: override?.width ?? size.width,
      height: override?.height ?? size.height,
      ...(inline ? { display: 'inline-block' } : {}),
    };
    node.children = []; // placeholders render as reserved space only
    return node;
  }
  if (node.type === 'text' && typeof node.text === 'string') {
    const text = decodeEntities(node.text);
    if (!node.tagName) return { ...node, text };
    const { text: _t, ...rest } = node;
    if (INLINE_TAGS.has(node.tagName)) {
      // Inline elements stay in fromHtml's native text-node form: takumi then attaches
      // ALL of the parent block's runs to the block itself, in visual order. Converting
      // inline nodes to containers splits their runs onto separate nodes, which breaks
      // document-order selection (phantom endpoints) and run widths.
      return { ...node, text };
    }
    // block element: a real block-div wrapper survives measurement as its own node,
    // so its transform = the parent's content-box origin (padding-exact geometry)
    return {
      ...rest,
      type: 'container',
      children: [{
        type: 'container',
        tagName: 'div',
        preset: { display: 'block' },
        children: [{ type: 'text', text }],
      }],
    };
  }
  if (node.children) {
    node.children = node.children
      .filter(c => !c.tagName || !NON_CONTENT_TAGS.has(c.tagName))
      .map(c => transform(c, state));
  }
  return node;
}

export function buildStoryNodeTree(
  html: string,
  embedSizes?: Record<number, { width: number; height: number }>,
  width = 1280,
): { node: RawNode; extractedStylesheets: string[] } {
  const parsed = fromHtml(html) as { node: RawNode; stylesheets?: string[] };
  return {
    node: transform(parsed.node, { embedIndex: 0, embedSizes, width }),
    extractedStylesheets: parsed.stylesheets ?? [],
  };
}
