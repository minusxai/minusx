/**
 * Story design-system CSS — server-side Tailwind compile (see story-css.ts for the contract).
 *
 * Compiles the Tailwind v4 utilities a story actually uses into a per-story CSS string, in
 * process (no build step, no network). Called from the FilesAPI write paths (createFile /
 * saveFile) for every story so `compiledCss` can never drift from the markup, whichever door
 * the write came through (agent EditFile, WYSIWYG browser save, raw API).
 */
import 'server-only';
import { compile } from '@tailwindcss/node';
import { STORY_UI_RECIPE_CLASSES } from '@/lib/story-ui/recipe-classes';
import { storyThemeCss } from './story-themes';
import { COLOR_PALETTE } from '@/lib/chart/chart-theme';
import { partitionBannedCandidates } from './banned-css';
import { hasDesignSystemMarker, extractClassCandidates, type CompiledCssStoryContent } from './story-css';

// The stylesheet each story is compiled against. `dark:` keys off the `.dark` class AgentHtml
// stamps on the iframe <html> (Tailwind's default is prefers-color-scheme, which would ignore
// the app's mode toggle).
const TW_INPUT = '@import "tailwindcss";\n@custom-variant dark (&:where(.dark, .dark *));\n';

/**
 * The shadcn v4 token layer for format:'jsx' stories (Story_Design_V2 §3):
 *  - `@theme inline` maps Tailwind color/radius utilities onto the shadcn CSS-variable
 *    contract, so `bg-card` / `text-muted-foreground` / `rounded-lg` compile and resolve
 *    through `--card` etc. — which themes (Phase 3) override per `[data-theme]`.
 *  - a stock-neutral `:root`/`.dark` default block so themeless stories look right.
 * Every compiled story (jsx AND legacy marked) uses TW_INPUT_JSX — post-6a the compiled sheet
 * is the embeds' only style source, so the token layer + recipe union apply across the board.
 */
/**
 * The `@theme inline` mapping that registers shadcn token utilities (`bg-background`,
 * `text-muted-foreground`, `rounded-lg`, …) onto the CSS-variable contract. Shared by the story
 * compile AND the app's main-document Tailwind build (scripts/generate-app-theme-css.ts —
 * Renderer_v2 Phase 3), so both surfaces speak the same token language.
 */
export const SHADCN_THEME_MAPPING = `@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}`;

/** Stock-neutral shadcn values, LIGHT — the themeless default (body only; caller picks the selector). */
export const SHADCN_NEUTRAL_LIGHT_BODY = `{
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0.005 285.823);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.141 0.005 285.823);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.141 0.005 285.823);
  --primary: oklch(0.21 0.006 285.885);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.967 0.001 286.375);
  --secondary-foreground: oklch(0.21 0.006 285.885);
  --muted: oklch(0.967 0.001 286.375);
  --muted-foreground: oklch(0.552 0.016 285.938);
  --accent: oklch(0.967 0.001 286.375);
  --accent-foreground: oklch(0.21 0.006 285.885);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.92 0.004 286.32);
  --input: oklch(0.92 0.004 286.32);
  --ring: oklch(0.705 0.015 286.067);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
}`;

/** Stock-neutral shadcn values, DARK (body only; caller picks the selector). */
export const SHADCN_NEUTRAL_DARK_BODY = `{
  --background: oklch(0.141 0.005 285.823);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.21 0.006 285.885);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.21 0.006 285.885);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.92 0.004 286.32);
  --primary-foreground: oklch(0.21 0.006 285.885);
  --secondary: oklch(0.274 0.006 286.033);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.274 0.006 286.033);
  --muted-foreground: oklch(0.705 0.015 286.067);
  --accent: oklch(0.274 0.006 286.033);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.552 0.016 285.938);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
}`;

/**
 * The MAIN document's shadcn token layer (Renderer_v2 Phase 3) — written to `app/theme-tokens.css`
 * by scripts/generate-app-theme-css.ts and imported by globals.css. Same sources as the story
 * compile; the difference is SCOPE: neutral values live under `[data-mx-theme-host]` (stamped by
 * FileLayout around file content) so the Chakra app shell never sees a bare `:root` override.
 */
// Unthemed content must keep TODAY'S chart colors (the visual bar — Renderer_v2 Phase 3):
// the stock shadcn --chart-1..5 would silently recolor every existing chart, because VegaChart
// reads those tokens wherever they resolve. Substitute the app palette (lib/chart/chart-theme
// COLOR_PALETTE head) into every NEUTRAL token body — app host blocks AND story neutral bodies
// alike; [data-theme] blocks still override.
const APP_CHARTS = COLOR_PALETTE.slice(0, 5);
const withAppCharts = (body: string): string =>
  body.replace(/--chart-([1-5]): [^;]+;/g, (_m, n: string) => `--chart-${n}: ${APP_CHARTS[Number(n) - 1]};`);

export function buildAppThemeCss(): string {
  return `/* GENERATED by scripts/generate-app-theme-css.ts — do not edit by hand. */
${SHADCN_THEME_MAPPING}
[data-mx-theme-host] ${withAppCharts(SHADCN_NEUTRAL_LIGHT_BODY)}
.dark [data-mx-theme-host] ${withAppCharts(SHADCN_NEUTRAL_DARK_BODY)}
${storyThemeCss()}
`;
}

const TW_INPUT_JSX = `${TW_INPUT}
${SHADCN_THEME_MAPPING}
:root ${withAppCharts(SHADCN_NEUTRAL_LIGHT_BODY)}
.dark ${withAppCharts(SHADCN_NEUTRAL_DARK_BODY)}
`;

/**
 * Flatten `@layer` out of compiled CSS: drop layer-statement lines (`@layer a, b;`) and unwrap
 * layer blocks to their contents, preserving rule order and any nested at-rules verbatim.
 *
 * Why: the story iframe also carries the app's mirrored stylesheet (reset included) UN-layered,
 * and un-layered CSS beats `@layer` CSS regardless of order or specificity — so layered
 * utilities silently lose every property the reset touches (padding/margins/font-size: the
 * "everything renders cramped" bug). Flat output competes by document order, where the story
 * sheet wins (it is injected after the mirror).
 */
function flattenCssLayers(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; ) {
    const at = css.indexOf('@layer', i);
    if (at === -1) { out += css.slice(i); break; }
    out += css.slice(i, at);
    const semi = css.indexOf(';', at);
    const brace = css.indexOf('{', at);
    if (brace === -1 || (semi !== -1 && semi < brace)) {
      // Statement form (`@layer a, b;`) — drop it.
      i = (semi === -1 ? css.length : semi + 1);
      continue;
    }
    // Block form — find the matching close brace and recurse into the contents.
    let depth = 1;
    let j = brace + 1;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    out += flattenCssLayers(css.slice(brace + 1, j - 1));
    i = j;
  }
  return out;
}

/**
 * Run `build` over `candidates`, salvaging on throw: bisect out the candidates that make the
 * build fail and compile the survivors. NEVER throws — a story save must never fail on a bad
 * class token, whatever a future Tailwind version decides to reject. Worst case (even the
 * empty build throws) returns empty CSS with every candidate reported dropped.
 */
export function buildSalvaging(
  build: (candidates: string[]) => string,
  candidates: string[],
): { css: string; dropped: string[] } {
  try {
    return { css: build(candidates), dropped: [] };
  } catch {
    if (candidates.length <= 1) return { css: '', dropped: candidates };
    const mid = Math.floor(candidates.length / 2);
    const left = buildSalvaging(build, candidates.slice(0, mid));
    const right = buildSalvaging(build, candidates.slice(mid));
    // Survivors must compile TOGETHER (build is one call in the non-throwing path): retry the
    // union of survivors once; if even that throws, fall back to concatenating the halves.
    const survivors = candidates.filter(c => !left.dropped.includes(c) && !right.dropped.includes(c));
    const dropped = [...left.dropped, ...right.dropped];
    try {
      return { css: build(survivors), dropped };
    } catch {
      return { css: left.css + right.css, dropped };
    }
  }
}

/**
 * Compile the story's Tailwind CSS. Returns null (no stylesheet) unless the story carries
 * the design-system marker — legacy stories must render byte-identical to before.
 *
 * A FRESH compiler per call: Tailwind's `build()` is accumulative (watch-mode semantics), so a
 * shared instance would leak utilities from one story's build into the next.
 *
 * Never throws on bad class tokens: `build()` runs through `buildSalvaging`, so a candidate a
 * future Tailwind rejects is dropped (and logged) instead of failing the caller's save.
 */
// Compile memo (Phase 6a): the read path (storyLoader) recompiles stale stories on every load,
// and every compile now carries the full recipe union — identical inputs recur (hot public
// stories, test fixtures), so cache by input. Bounded FIFO; entries are immutable strings.
// eslint-disable-next-line no-restricted-syntax -- process-lifetime memo keyed by full input; no per-request scope
const compileMemo = new Map<string, Promise<string | null>>();
const COMPILE_MEMO_CAP = 50;

export async function compileStoryCss(story: string | null | undefined, opts?: { force?: boolean }): Promise<string | null> {
  if (!story || (!opts?.force && !hasDesignSystemMarker(story))) return null;
  const memoKey = `${opts?.force ? 'jsx' : 'legacy'}|${storyCssCompileVersion()}|${story}`;
  const memoized = compileMemo.get(memoKey);
  if (memoized) return memoized;
  const result = compileStoryCssUncached(story, opts);
  if (compileMemo.size >= COMPILE_MEMO_CAP) {
    const oldest = compileMemo.keys().next().value;
    if (oldest !== undefined) compileMemo.delete(oldest);
  }
  compileMemo.set(memoKey, result);
  // A failed compile must not be cached as a permanent null-ish poison — drop it on rejection.
  result.catch(() => compileMemo.delete(memoKey));
  return result;
}

async function compileStoryCssUncached(story: string, opts?: { force?: boolean }): Promise<string | null> {
  // EVERY compiled story (jsx AND marked legacy) gets the shadcn token layer + the registry
  // recipe classes unioned in: component chrome classes never appear in story markup, and after
  // the 6a mirror shrink the compiled sheet is the embeds' ONLY style source. The token layer is
  // additive (host-scoped), so legacy authored css is unaffected.
  const jsx = !!opts?.force;
  const compiler = await compile(TW_INPUT_JSX, { base: process.cwd(), onDependency: () => {} });
  let candidates = [...new Set([...extractClassCandidates(story), ...STORY_UI_RECIPE_CLASSES])].sort();
  if (jsx) {
    // Banned-CSS guard (Story_Design_V2 §4) — a SEPARATE, explicit step BEFORE compile, never
    // folded into buildSalvaging's error-bisect: a guard reject must be a deliberate drop, not a
    // silently-absorbed "bad token". Legacy marked stories are frozen and skip this.
    const { kept, banned } = partitionBannedCandidates(candidates);
    if (banned.length > 0) {
      console.warn(`[story-css] dropped ${banned.length} banned class candidate(s) (fixed/sticky/external-url):`, banned.join(' '));
    }
    candidates = kept;
  }
  const { css, dropped } = buildSalvaging(c => compiler.build(c), candidates);
  if (dropped.length > 0) {
    console.warn(`[story-css] dropped ${dropped.length} uncompilable class candidate(s):`, dropped.join(' '));
  }
  // Theme token blocks (Story_Design_V2 §5): ALL themes' `[data-theme]` variable blocks ship in
  // every jsx story's compiledCss, so switching theme is an attribute change only (no recompile).
  // Appended AFTER the compiled sheet: the attribute-scoped blocks beat the `:root`/`.dark`
  // neutral defaults on document order, while authored <style> blocks still come later in the
  // iframe and win over everything here.
  return flattenCssLayers(css) + (jsx ? `\n${storyThemeCss()}` : '');
}

/**
 * Version of the compile ENVIRONMENT a `compiledCss` was produced under: a hash of the recipe
 * union (kit + embed-chrome classes) + the theme token emitter output. When either grows (a new
 * embed component is re-skinned, a theme changes), every previously-saved story is STALE — the
 * story loader (lib/data/loaders/story-loader.ts) recompiles it at read time. Self-maintaining:
 * no manual version bumps.
 */
export function storyCssCompileVersion(): string {
  const src = `${STORY_UI_RECIPE_CLASSES.join(' ')}|${storyThemeCss()}`;
  // djb2 — stability matters, cryptographic strength doesn't.
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  return `v${(h >>> 0).toString(36)}`;
}

/**
 * Recompute `compiledCss` for a story content object (any client-sent value is discarded), and
 * stamp the compile-environment version so the read path can detect staleness.
 * `format:'jsx'` stories ALWAYS compile — new stories are design-system by definition, no
 * `data-design="tw"` marker needed; legacy stories keep the marker gate.
 */
export async function withCompiledStoryCss<T extends { story?: string | null; format?: string | null }>(
  content: T,
): Promise<T & CompiledCssStoryContent> {
  return {
    ...content,
    compiledCss: await compileStoryCss(content.story, { force: content.format === 'jsx' }),
    cssCompileVersion: storyCssCompileVersion(),
  } as T & CompiledCssStoryContent;
}
