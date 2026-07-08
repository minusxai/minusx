/**
 * Story design-system components (File Architecture v2, design-system stories).
 *
 * shadcn-style presentational primitives the agent can use in a story body instead of
 * hand-writing container markup + utility soup. Each is a REGISTERED JSX component name
 * (lib/jsx/components.ts) whose codec compiles to STATIC HTML at parseStoryJsx time — no
 * React, no runtime: just a container element with a curated Tailwind class recipe and a
 * `data-c="<Name>"` stamp for the reverse pass (buildStoryJsx → agent markup).
 *
 * Design rules that keep every edit path lossless:
 *  - Text always lives in CHILDREN, never in props — a WYSIWYG text edit changes the DOM
 *    text node and round-trips; there is no prop copy to go stale.
 *  - Props are ENUMS ONLY (tone, cols), stamped as `data-*` attributes on the emitted
 *    element so the reverse pass can rebuild the component call exactly.
 *  - Children nest arbitrarily (components, embeds, prose); the reverse pass depth-matches
 *    the container's own tag name, so same-tag nesting (Card in Card) is safe.
 *
 * The Tailwind classes live in the emitted HTML, so the save-time compiler (story-css.server)
 * picks them up with no extra wiring, and `dark:` variants key off the iframe's `.dark` class.
 *
 * Attribute safety: recipes use arbitrary-variant selectors (`[&>p]:`, `[&_ul]:`) whose `&`/`>`
 * would break the tag-boundary scanners over stored HTML (the PR #575 bug class) — so every
 * emitted attribute value is entity-escaped (escAttr), and the save-time candidate extraction
 * decodes them back (story-css.ts).
 */
import { escAttr, unescAttr } from './html-attr';

interface StoryComponentDef {
  /** The HTML container the component compiles to. */
  tag: 'section' | 'div' | 'span' | 'p' | 'blockquote' | 'h2';
  /** Enum props: name → allowed values; the FIRST value is the default. */
  props?: Record<string, readonly string[]>;
  /** Class recipe for the resolved props. */
  classes: (props: Record<string, string>) => string;
}

const TONE_PILL: Record<string, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  bad: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
};

const TONE_DELTA: Record<string, string> = {
  neutral: 'text-slate-500 dark:text-slate-400',
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-red-600 dark:text-red-400',
};

const TONE_CALLOUT: Record<string, string> = {
  info: 'border-blue-500 bg-blue-50 dark:bg-blue-950/40',
  good: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40',
  warn: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40',
  bad: 'border-red-500 bg-red-50 dark:bg-red-950/40',
};

const GRID_COLS: Record<string, string> = {
  '2': 'grid-cols-1 @xl:grid-cols-2',
  '3': 'grid-cols-1 @lg:grid-cols-2 @3xl:grid-cols-3',
  '4': 'grid-cols-1 @lg:grid-cols-2 @3xl:grid-cols-4',
};

export const STORY_COMPONENTS: Record<string, StoryComponentDef> = {
  Section: {
    tag: 'section',
    classes: () => 'py-8 @2xl:py-12 border-b border-slate-200 dark:border-slate-800',
  },
  // The ACCENT CHANNEL: recipes that carry the story's personality read --st-accent (with a
  // refined teal default), so the root re-themes the whole story in one arbitrary property:
  // <div data-design="tw" class="… [--st-accent:#b45309]">. Data colors (StatDelta/Pill tones)
  // stay semantic and are NOT accent-driven.
  Eyebrow: {
    tag: 'p',
    classes: () => 'text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--st-accent,#0f766e)] mb-2',
  },
  Grid: {
    tag: 'div',
    props: { cols: ['3', '2', '4'] },
    classes: (p) => `grid gap-4 ${GRID_COLS[p.cols]}`,
  },
  Card: {
    tag: 'div',
    classes: () => 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 min-w-0',
  },
  Stat: {
    tag: 'div',
    classes: () => 'flex flex-col gap-1',
  },
  StatLabel: {
    tag: 'p',
    classes: () => 'text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400',
  },
  StatValue: {
    tag: 'p',
    classes: () => 'text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50',
  },
  StatDelta: {
    tag: 'p',
    props: { tone: ['neutral', 'up', 'down'] },
    classes: (p) => `text-sm font-bold tabular-nums ${TONE_DELTA[p.tone]}`,
  },
  Pill: {
    tag: 'span',
    props: { tone: ['neutral', 'good', 'bad', 'warn', 'info'] },
    classes: (p) => `inline-block rounded-full px-2.5 py-1 text-[13px] font-bold ${TONE_PILL[p.tone]}`,
  },
  Callout: {
    tag: 'div',
    props: { tone: ['info', 'good', 'warn', 'bad'] },
    classes: (p) => `rounded-xl border-l-4 p-4 my-4 ${TONE_CALLOUT[p.tone]}`,
  },
  Quote: {
    tag: 'blockquote',
    classes: () => 'border-y-2 border-slate-900 dark:border-slate-100 py-6 my-6 font-serif italic text-xl text-slate-800 dark:text-slate-100',
  },

  // ── Higher-order components: the beautiful-by-default layer ─────────────────────────────
  // These bake the typographic/spacing decisions a designed board deck needs, so the default
  // dashboard→story pass is components + content with almost no utility classes.
  Headline: {
    tag: 'h2',
    classes: () =>
      'text-4xl @2xl:text-6xl font-semibold leading-[1.04] tracking-[-0.03em] text-slate-950 dark:text-slate-50 [text-wrap:balance] mt-3 max-w-[24ch] ' +
      '[&_strong]:text-[color:var(--st-accent,#0f766e)] [&_strong]:font-semibold', // <strong> the key figure in the claim → it takes the accent
  },
  Standfirst: {
    tag: 'p',
    classes: () => 'font-serif italic text-lg @2xl:text-2xl leading-relaxed text-slate-500 dark:text-slate-400 mt-5 max-w-[62ch]',
  },
  PageHeader: {
    tag: 'div',
    classes: () => 'flex justify-between items-baseline gap-4 pt-1 pb-6 text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500',
  },
  PageFooter: {
    tag: 'div',
    classes: () => 'flex justify-between items-center gap-4 mt-12 pt-4 border-t border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500',
  },
  Takeaways: {
    tag: 'div',
    classes: () =>
      'rounded-2xl border border-slate-200 bg-slate-50 p-6 mt-10 dark:border-slate-800 dark:bg-slate-900 ' +
      'border-l-4 border-l-[color:var(--st-accent,#0f766e)] ' +
      '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_ul]:mt-3 [&_li]:leading-relaxed [&_strong]:text-slate-900 dark:[&_strong]:text-slate-100',
  },
  FigurePlate: {
    tag: 'div',
    classes: () =>
      'rounded-2xl border border-slate-200 bg-white p-4 @2xl:p-5 shadow-sm mt-10 min-w-0 dark:border-slate-800 dark:bg-slate-900 ' +
      '[&>p]:mt-3 [&>p]:text-sm [&>p]:text-slate-500 dark:[&>p]:text-slate-400',
  },
};

export const STORY_COMPONENT_NAMES = Object.keys(STORY_COMPONENTS);

/**
 * Compile one component call to its stored-HTML container. Returns null for unknown names
 * (caller falls through to plain-tag handling). Unknown/invalid prop values resolve to the
 * prop's default (first allowed value) — the agent can never produce a broken recipe.
 */
export function emitStoryComponent(
  name: string,
  attrs: Record<string, unknown>,
  childrenHtml: string,
): string | null {
  const def = STORY_COMPONENTS[name];
  if (!def) return null;
  const resolved: Record<string, string> = {};
  let dataAttrs = '';
  for (const [prop, allowed] of Object.entries(def.props ?? {})) {
    const raw = String(attrs[prop] ?? '');
    // Interpolate the ALLOWLIST constant (never the input), so only hardcoded enum tokens can
    // reach the attribute — and belt-and-braces escape it anyway (also satisfies CodeQL).
    const idx = allowed.indexOf(raw);
    const value = idx >= 0 ? allowed[idx] : allowed[0];
    resolved[prop] = value;
    dataAttrs += ` data-${prop}="${escAttr(value)}"`;
  }
  // Optional `class` prop: custom utilities appended AFTER the recipe, and stamped in data-cls
  // so the reverse pass can split custom from recipe. Quotes are stripped (no Tailwind class
  // needs them — and it kills attribute breakout); the rest is entity-escaped like every other
  // stored attribute value.
  let custom = '';
  if (typeof attrs.class === 'string') {
    custom = attrs.class.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
    if (custom) dataAttrs += ` data-cls="${escAttr(custom)}"`;
  }
  const cls = def.classes(resolved) + (custom ? ` ${custom}` : '');
  return `<${def.tag} data-c="${name}"${dataAttrs} class="${escAttr(cls)}">${childrenHtml}</${def.tag}>`;
}

/**
 * Reverse pass for buildStoryJsx: rewrite every `data-c` container in stored HTML back to its
 * component form (`<div data-c="Pill" data-tone="bad" class="…">▼ 3%</div>` → `<Pill
 * tone="bad">▼ 3%</Pill>`). Depth-matches the container's own tag, innermost-safe; the class
 * attribute is DROPPED (it is derived output, re-emitted on the next parse). Run AFTER the
 * placeholder reversals so embed divs inside components are already `<Question/>` jsx.
 */
export function reverseStoryComponents(html: string): string {
  const OPEN_RE = /<(section|div|span|p|blockquote|h2)\b[^>]*\bdata-c="([A-Za-z]+)"[^>]*>/;
  let out = html;
  // Innermost-first: repeatedly rewrite containers whose inner HTML holds no further data-c
  // stamp, until none remain. Each rewrite is one depth-matched container, so same-tag nesting
  // and sibling runs are both safe; unknown names keep their stamp and are skipped via a cursor.
  let searchFrom = 0;
  for (let guard = 0; guard < 10000; guard++) {
    const m = OPEN_RE.exec(out.slice(searchFrom));
    if (!m) break;
    const openStart = searchFrom + m.index;
    const [openTagHtml, tag, name] = m;
    const def = STORY_COMPONENTS[name];
    if (!def) { searchFrom = openStart + openTagHtml.length; continue; }

    // Depth-match this container's own tag to find its close.
    const tokenRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'g');
    tokenRe.lastIndex = openStart + openTagHtml.length;
    let depth = 1;
    let closeStart = -1;
    for (let t = tokenRe.exec(out); t; t = tokenRe.exec(out)) {
      depth += t[0].startsWith(`</`) ? -1 : 1;
      if (depth === 0) { closeStart = t.index; break; }
    }
    if (closeStart === -1) { searchFrom = openStart + openTagHtml.length; continue; } // unbalanced: leave as-is

    const inner = reverseStoryComponents(out.slice(openStart + openTagHtml.length, closeStart));
    let props = '';
    for (const prop of Object.keys(def.props ?? {})) {
      const pm = openTagHtml.match(new RegExp(`\\bdata-${prop}="([^"]*)"`));
      if (pm) props += prop === 'cols' ? ` ${prop}={${pm[1]}}` : ` ${prop}="${pm[1]}"`;
    }
    // Quote-strip AFTER un-escaping: legitimately-emitted data-cls never contains quotes (the
    // emit side strips them), so any that appear post-decode are forged stored content trying
    // to break out of the quoted class prop — enforce the same invariant in both directions.
    const cm = openTagHtml.match(/\bdata-cls="([^"]*)"/);
    if (cm) props += ` class="${unescAttr(cm[1]).replace(/["']/g, '')}"`;
    const replacement = `<${name}${props}>${inner}</${name}>`;
    out = out.slice(0, openStart) + replacement + out.slice(closeStart + `</${tag}>`.length);
    searchFrom = openStart + replacement.length;
  }
  return out;
}
