import { parseJsx } from '@/lib/jsx';
import type { JsonValue, JsxElement, JsxNode } from '@/lib/jsx';
import { buildStoryJsx } from '@/lib/data/story/story-v2';
import type { StoryContent } from '@/lib/types';
import type { DeterministicContext, RubricFinding } from '../types';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { distinctHexColors, findFactualNumbers, finding, hasFontFamily, isBlank } from './shared';
import { parseTopLevelClassRules, scanStoryLayout } from './story-layout';

const MIN_COLORS = 2;
const MAX_COLORS = 10;

// Width thresholds. A story column is ~1280px on desktop; a cartesian plot needs at least half of
// it to read, a pie/funnel can go narrower. `fraction` is the embed's share of that column; `minPx`
// is any hard px cap. See `frontend/docs/rubrik.md` (Story rule catalog).
const CARTESIAN = immutableSet(['line', 'area', 'bar', 'scatter']);
const ROUND = immutableSet(['pie', 'funnel']);
const MIN_CARTESIAN_FRACTION = 0.5;
const MIN_ROUND_FRACTION = 0.34;
const MIN_CARTESIAN_PX = 480;
const MIN_ROUND_PX = 260;

interface StoryScan {
  embeds: number;        // <Question> / <Number> count
  headings: number;      // <h1>/<h2> count
  css: string;           // concatenated <style> content
  proseNumbers: string[]; // factual figures typed into prose (outside embeds/style)
}

function walk(nodes: JsxNode[], acc: StoryScan, insideStyle: boolean): void {
  for (const n of nodes) {
    if (n.type === 'text') {
      if (!insideStyle) acc.proseNumbers.push(...findFactualNumbers(n.value));
      continue;
    }
    if (n.type === 'expression') {
      if (insideStyle && n.value.static && typeof n.value.json === 'string') acc.css += n.value.json;
      continue;
    }
    // element
    if (n.tag === 'Question' || n.tag === 'Number') { acc.embeds++; continue; }
    if (n.tag === 'Param') continue;
    if (/^h[12]$/i.test(n.tag)) acc.headings++;
    walk(n.children, acc, insideStyle || n.tag.toLowerCase() === 'style');
  }
}

// ── page gutter detection ─────────────────────────────────────────────────────
// The iframe body renders with margin 0 and NO component owns horizontal padding, so the page
// gutter must live in the story markup itself — on the root (`px-6`, inline padding, or a root
// class's CSS padding) or on the top-level sections. Without it, content sits flush against the
// viewport edge: the single most common first-render flaw.

const PAD_CLASS_RE = /(?:^|\s)(?:p|px|pl|pr)-/;

function staticAttr(el: JsxElement, name: string): JsonValue | undefined {
  const a = el.attributes.find((x) => x.name === name);
  return a && a.value.static ? a.value.json : undefined;
}

/** Does this element carry horizontal padding — via Tailwind class, inline style, or a CSS rule
 *  (in `css`) on one of its classes? */
function hasHorizontalPadding(el: JsxElement, css: string): boolean {
  const cls = staticAttr(el, 'className') ?? staticAttr(el, 'class');
  const classes = typeof cls === 'string' ? cls.split(/\s+/).filter(Boolean) : [];
  if (typeof cls === 'string' && PAD_CLASS_RE.test(cls)) return true;
  const style = staticAttr(el, 'style');
  if (typeof style === 'string' && /padding/i.test(style)) return true;
  if (style && typeof style === 'object' && !Array.isArray(style)
    && Object.keys(style).some((k) => /^padding/i.test(k))) return true;
  return classes.some((c) => new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])[^{}]*\\{[^{}]*padding`, 'i').test(css));
}

/** True when the story has a page gutter: the root element is padded, or most of its direct
 *  element children are (per-section gutters; a minority of full-bleed elements is fine). */
function hasPageGutter(nodes: JsxNode[], css: string): boolean {
  const root = nodes.find((n): n is JsxElement => n.type === 'element' && n.tag.toLowerCase() !== 'style');
  if (!root) return true; // nothing to judge
  if (hasHorizontalPadding(root, css)) return true;
  const children = root.children.filter((n): n is JsxElement =>
    n.type === 'element' && !['style', 'Param'].includes(n.tag));
  if (children.length === 0) return false;
  const padded = children.filter((c) => hasHorizontalPadding(c, css)).length;
  return padded >= Math.ceil(children.length / 2);
}

/**
 * A story body is STORED as placeholder-div HTML (`<div data-question-id>`, raw `<style>`); the
 * clean `<Question viz=… />` JSX only exists in the agent markup. Normalize to that agent form so
 * every rule reads what the agent reads. Already-JSX input (agent markup, test fixtures) is passed
 * through untouched — re-running the codec on it would double-wrap `<style>` blocks.
 */
function toAgentBodyJsx(story: string): string {
  if (/<(?:Question|Number|Param)\b/.test(story) || /<style>\s*\{/.test(story)) return story;
  return buildStoryJsx({ story } as StoryContent);
}

/** Deterministic health findings for a story. `ctx.vizTypeByQuestionId` resolves saved (`id={N}`)
 *  embeds' chart types for the width rule (inline embeds carry their own `viz`). */
export function scoreStory(content: StoryContent, ctx?: DeterministicContext): RubricFinding[] {
  const out: RubricFinding[] = [];

  // no-lead (clarity) — uses the description field directly, not the body
  if (isBlank(content.description)) {
    out.push(finding('story.no-lead', 'clarity', 'warn', 'No lead',
      'The story has no description/lead.',
      'State the single lead finding (with its number) in the description.', 0.25));
  }

  const bodyJsx = toAgentBodyJsx(content.story ?? '');
  const acc: StoryScan = { embeds: 0, headings: 0, css: '', proseNumbers: [] };
  const parsed = parseJsx(bodyJsx);
  if (parsed.ok) walk(parsed.nodes, acc, false);

  // no-evidence (correctness)
  if (acc.embeds === 0) {
    out.push(finding('story.no-evidence', 'correctness', 'error', 'No live evidence',
      'The story body has no <Question> or <Number> embeds.',
      'Back the narrative with at least one live chart (<Question>) or number (<Number>).'));
  }

  // no-headline (clarity)
  if (acc.headings === 0) {
    out.push(finding('story.no-headline', 'clarity', 'warn', 'No headline',
      'The story body has no <h1>/<h2> heading.',
      'Add a headline that states the finding (a claim with a number), not a topic.'));
  }

  // typed-number (correctness)
  if (acc.proseNumbers.length > 0) {
    const first = acc.proseNumbers[0];
    out.push(finding('story.typed-number', 'correctness', 'warn', 'Hardcoded number in prose',
      `A factual figure "${first}" is typed into prose instead of a live embed.`,
      `Replace the typed figure "${first}" with a live <Number> embed so it can't go stale or be wrong.`));
  }

  // no-page-gutter (aesthetics) — content flush against the viewport edge
  if (parsed.ok && !hasPageGutter(parsed.nodes, acc.css)) {
    out.push(finding('story.no-page-gutter', 'aesthetics', 'warn', 'No page gutter',
      'Neither the root element nor its top-level sections carry horizontal padding — content sits flush against the viewport edge.',
      'Add a page gutter on the root div (e.g. `px-6 @2xl:px-12`, or padding in its CSS class) so text and charts never touch the edge.'));
  }

  // design tokens (aesthetics)
  const colors = distinctHexColors(acc.css);
  const fonts = hasFontFamily(acc.css);
  if (colors.length < MIN_COLORS || !fonts) {
    out.push(finding('story.no-design-tokens', 'aesthetics', 'warn', 'Thin design tokens',
      `The style block defines ${colors.length} color(s)${fonts ? '' : ' and no font-family'}.`,
      'Define a deliberate palette (4–6 named hex colors) and ~3 font roles before styling.', 0.5));
  } else if (colors.length > MAX_COLORS) {
    out.push(finding('story.too-many-colors', 'aesthetics', 'warn', 'Too many colors',
      `The style block defines ${colors.length} distinct colors.`,
      'Reduce to a disciplined 4–6 color palette with one protagonist accent.', 0.25));
  }

  // ── layout-aware rules (width + params) ──────────────────────────────────────
  const scan = scanStoryLayout(bodyJsx, parseTopLevelClassRules(acc.css));
  const vizById = ctx?.vizTypeByQuestionId;

  // embed-too-narrow (clarity) — cartesian/pie charts squeezed below a legible width.
  const narrow: string[] = [];
  for (const e of scan.embeds) {
    const vt = e.vizType ?? (e.savedId != null ? vizById?.[e.savedId] : undefined);
    if (!vt) continue; // unknown type (saved embed with no ctx) — can't judge, skip
    const cartesian = CARTESIAN.has(vt);
    const round = ROUND.has(vt);
    if (!cartesian && !round) continue;
    const minFrac = cartesian ? MIN_CARTESIAN_FRACTION : MIN_ROUND_FRACTION;
    const minPx = cartesian ? MIN_CARTESIAN_PX : MIN_ROUND_PX;
    if (e.fraction < minFrac - 1e-6 || (e.minPx !== null && e.minPx < minPx)) {
      const where = e.fraction < minFrac - 1e-6 ? `~${Math.round(e.fraction * 100)}% of the column` : `${e.minPx}px wide`;
      narrow.push(`${vt} chart at ${where}`);
    }
  }
  if (narrow.length > 0) {
    out.push(finding('story.embed-too-narrow', 'clarity', 'error', 'Chart too narrow',
      `${narrow.length} chart(s) are squeezed too narrow to read (${narrow[0]}). Cartesian plots (line/area/bar/scatter) need ≥${MIN_CARTESIAN_FRACTION * 100}% of the column; pie/funnel need ≥${Math.round(MIN_ROUND_FRACTION * 100)}%.`,
      'Give charts room: drop packed multi-column grids to 1–2 columns, remove fixed narrow px widths, and let each plot fill its cell (width:100%).'));
  }

  // undeclared-param (correctness) — an inline query :token declared by neither <Param>, the
  // embed's own params prop, nor parameterValues, so the embed silently fails to run.
  const declared = new Set<string>([...scan.declaredParams, ...Object.keys(content.parameterValues ?? {})]);
  const undeclared = new Set<string>();
  for (const ref of scan.paramRefs) {
    const local = new Set(ref.local);
    for (const name of ref.refs) if (!declared.has(name) && !local.has(name)) undeclared.add(name);
  }
  if (undeclared.size > 0) {
    const names = [...undeclared];
    out.push(finding('story.undeclared-param', 'correctness', 'error', 'Undeclared parameter',
      `Inline query param(s) ${names.map((n) => `:${n}`).join(', ')} are referenced but never declared.`,
      `Declare ${names.map((n) => `"${n}"`).join(', ')} via a <Param name="…"> filter, the embed's own params prop, or parameterValues — or remove the :token.`));
  }

  return out;
}
