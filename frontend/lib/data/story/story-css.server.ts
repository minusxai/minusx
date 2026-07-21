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
import { hasDesignSystemMarker, extractClassCandidates, type CompiledCssStoryContent } from './story-css';

// The stylesheet each story is compiled against. `dark:` keys off the `.dark` class AgentHtml
// stamps on the iframe <html> (Tailwind's default is prefers-color-scheme, which would ignore
// the app's mode toggle).
const TW_INPUT = '@import "tailwindcss";\n@custom-variant dark (&:where(.dark, .dark *));\n';

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
export async function compileStoryCss(story: string | null | undefined): Promise<string | null> {
  if (!story || !hasDesignSystemMarker(story)) return null;
  const compiler = await compile(TW_INPUT, { base: process.cwd(), onDependency: () => {} });
  const { css, dropped } = buildSalvaging(c => compiler.build(c), extractClassCandidates(story));
  if (dropped.length > 0) {
    console.warn(`[story-css] dropped ${dropped.length} uncompilable class candidate(s):`, dropped.join(' '));
  }
  return flattenCssLayers(css);
}

/** Recompute `compiledCss` for a story content object (any client-sent value is discarded). */
export async function withCompiledStoryCss<T extends { story?: string | null }>(
  content: T,
): Promise<T & CompiledCssStoryContent> {
  return { ...content, compiledCss: await compileStoryCss(content.story) } as T & CompiledCssStoryContent;
}
