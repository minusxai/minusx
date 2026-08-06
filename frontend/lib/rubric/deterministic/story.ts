import { parseJsx } from '@/lib/jsx';
import type { JsonValue, JsxElement, JsxNode } from '@/lib/jsx';
import { buildStoryJsx } from '@/lib/data/story/story-v2';
import type { StoryContent } from '@/lib/types';
import type { DeterministicContext, RubricFinding } from '../types';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { gridCols, gridItemRect, type GridItemRect } from '@/lib/story-ui/grid-layout';
import { findFactualNumbers, finding, isBlank } from './shared';
import { parseTopLevelClassRules, scanStoryLayout } from './story-layout';

// Width thresholds. A story column is ~1280px on desktop; a cartesian plot needs at least half of
// it to read, a pie/funnel can go narrower. `fraction` is the embed's share of that column; `minPx`
// is any hard px cap.
const CARTESIAN = immutableSet(['line', 'area', 'bar', 'scatter']);
const ROUND = immutableSet(['pie', 'funnel']);
const MIN_CARTESIAN_FRACTION = 0.5;
const MIN_ROUND_FRACTION = 0.34;
const MIN_CARTESIAN_PX = 480;
const MIN_ROUND_PX = 260;

interface StoryScan {
  embeds: number;        // <Question> / <Number> count
  headlines: number;     // <h1>/<h2> count (decks commonly lead with h2 slide titles)
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
    if (/^h[12]$/i.test(n.tag)) acc.headlines++;
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

interface GridHealth {
  droppedContent: number;
  overlap?: string;
}

function rectsOverlap(a: GridItemRect, b: GridItemRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Inspect modern story Grid structure. Non-GridItem direct children are dropped by Grid at
 * render time; overlapping authored rectangles obscure one another. */
function inspectGrids(nodes: JsxNode[]): GridHealth {
  const health: GridHealth = { droppedContent: 0 };
  const visit = (node: JsxNode): void => {
    if (node.type !== 'element') return;
    if (node.tag === 'Grid') {
      const meaningful = node.children.filter((child) => child.type !== 'text' || child.value.trim() !== '');
      const items = meaningful.filter((child): child is JsxElement => child.type === 'element' && child.tag === 'GridItem');
      health.droppedContent += meaningful.length - items.length;
      if (items.length === 0) health.droppedContent++;
      const cols = gridCols(staticAttr(node, 'cols'));
      const rects = items.map((item) => gridItemRect({
        x: staticAttr(item, 'x'), y: staticAttr(item, 'y'),
        w: staticAttr(item, 'w'), h: staticAttr(item, 'h'),
      }, cols));
      for (let i = 0; i < rects.length && !health.overlap; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          if (rectsOverlap(rects[i], rects[j])) {
            health.overlap = `GridItems ${i + 1} and ${j + 1} overlap at (${rects[i].x},${rects[i].y}) and (${rects[j].x},${rects[j].y}).`;
            break;
          }
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return health;
}

function modernRootProblems(nodes: JsxNode[]): string[] {
  const root = nodes.find((node): node is JsxElement =>
    node.type === 'element' && node.tag.toLowerCase() !== 'style');
  if (!root) return [];
  const problems: string[] = [];
  if (staticAttr(root, 'data-design') !== 'tw') problems.push('data-design="tw"');
  const cls = staticAttr(root, 'className') ?? staticAttr(root, 'class');
  const classes = typeof cls === 'string' ? cls.split(/\s+/) : [];
  const ownsContainer = root.tag === 'Grid' || root.tag === 'SlideDeck';
  if (!ownsContainer && !classes.includes('@container')) problems.push('@container');
  return problems;
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
    out.push(finding('story.no-lead', 'No lead',
      'The story has no description/lead.',
      'Add a concise description stating the story’s main finding or purpose.'));
  }

  const bodyJsx = toAgentBodyJsx(content.story ?? '');
  const acc: StoryScan = { embeds: 0, headlines: 0, css: '', proseNumbers: [] };
  const parsed = parseJsx(bodyJsx);
  if (parsed.ok) walk(parsed.nodes, acc, false);

  // no-evidence (correctness)
  if (acc.embeds === 0) {
    out.push(finding('story.no-evidence', 'No live evidence',
      'The story body has no <Question> or <Number> embeds.',
      'Back the narrative with at least one live chart (<Question>) or number (<Number>).'));
  }

  // no-headline (clarity)
  if (acc.headlines === 0) {
    out.push(finding('story.no-headline', 'No headline',
      'The story body has no <h1>/<h2> headline.',
      'Add a prominent heading that states the main finding, not merely the topic.'));
  }

  // typed-number (correctness)
  if (acc.proseNumbers.length > 0) {
    const first = acc.proseNumbers[0];
    out.push(finding('story.typed-number', 'Hardcoded number in prose',
      `A factual figure "${first}" is typed into prose instead of a live embed.`,
      `Replace the typed figure "${first}" with a live <Number> embed so it can't go stale or be wrong.`));
  }

  // Modern JSX root contract: the marker selects the design system; @container makes all
  // descendant container-query variants responsive.
  if (content.format === 'jsx' && parsed.ok) {
    const missing = modernRootProblems(parsed.nodes);
    if (missing.length > 0) {
      out.push(finding('story.modern-root-incomplete', 'Modern story root is incomplete',
        `The root is missing ${missing.join(' and ')}.`,
        'Use one root wrapper with `data-design="tw"` and `className="@container w-full …"`.'));
    }
  }

  // Modern Grid structure/geometry. These checks are meaningful for legacy JSX too when it uses
  // the registered Grid components.
  if (parsed.ok) {
    const grid = inspectGrids(parsed.nodes);
    if (grid.droppedContent > 0) {
      out.push(finding('story.grid-content-invalid', 'Grid contains invisible content',
        `${grid.droppedContent} direct Grid child item(s) are not GridItem elements (or the Grid is empty); Grid drops them at render time.`,
        'Wrap every direct Grid child in <GridItem x={...} y={...} w={...} h={...}> and remove empty Grids.'));
    }
    if (grid.overlap) {
      out.push(finding('story.grid-overlap', 'Overlapping story grid items', grid.overlap,
        'Adjust GridItem x/y/w/h so their 12-column rectangles do not overlap.'));
    }
  }

  // no-page-gutter (aesthetics) — content flush against the viewport edge
  if (parsed.ok && !hasPageGutter(parsed.nodes, acc.css)) {
    out.push(finding('story.no-page-gutter', 'No page gutter',
      'Neither the root element nor its top-level sections carry horizontal padding — content sits flush against the viewport edge.',
      'Add a Tailwind page gutter on the root or its top-level sections (for example `px-6 @2xl:px-12`) so content never touches the edge.'));
  }

  // ── layout-aware rules (width + params) ──────────────────────────────────────
  const scan = scanStoryLayout(bodyJsx, parseTopLevelClassRules(acc.css));
  const vizById = ctx?.vizTypeByQuestionId;

  // embed-too-narrow (clarity) — cartesian/pie charts squeezed below a legible width.
  // MEASURED widths (real pixels from the rendered iframe, provided by the review path)
  // supersede the static CSS estimate entirely — the static scan only simulates layout from
  // parseable CSS plus modern Grid props, but is blind to arbitrary utility-class layouts.
  const narrow: string[] = [];
  if (ctx?.measuredEmbeds) {
    for (const m of ctx.measuredEmbeds) {
      const vt = m.vizType;
      if (!vt || !(CARTESIAN.has(vt) || ROUND.has(vt)) || m.columnPx <= 0) continue;
      const cartesian = CARTESIAN.has(vt);
      const minFrac = cartesian ? MIN_CARTESIAN_FRACTION : MIN_ROUND_FRACTION;
      const minPx = cartesian ? MIN_CARTESIAN_PX : MIN_ROUND_PX;
      if (m.widthPx / m.columnPx < minFrac - 1e-6 && m.widthPx < minPx) {
        narrow.push(`${vt} chart rendered at ${Math.round(m.widthPx)}px (~${Math.round((m.widthPx / m.columnPx) * 100)}% of the ${Math.round(m.columnPx)}px column)`);
      }
    }
  } else {
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
  }
  if (narrow.length > 0) {
    out.push(finding('story.embed-too-narrow', 'Chart too narrow',
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
    out.push(finding('story.undeclared-param', 'Undeclared parameter',
      `Inline query param(s) ${names.map((n) => `:${n}`).join(', ')} are referenced but never declared.`,
      `Declare ${names.map((n) => `"${n}"`).join(', ')} via a <Param name="…"> filter, the embed's own params prop, or parameterValues — or remove the :token.`));
  }

  return out;
}
