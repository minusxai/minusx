/**
 * Story design-system CSS — shared (client-safe) contract.
 *
 * Stories that opt into the built-in design system carry `data-design="tw"` on their root
 * wrapper and style themselves with Tailwind utility classes instead of an authored
 * stylesheet. At save time the server compiles exactly the utilities the story uses into a
 * per-story CSS blob (see story-css.server.ts), persisted on the content as `compiledCss` —
 * a SERVER-MANAGED field: it is not part of the authored StoryContent schema, is never shown
 * to the agent (contentToJsx iterates schema fields only), and is recomputed on every save.
 * At render time AgentHtml injects it into the story iframe's <head>.
 *
 * Legacy stories (no marker) get `compiledCss: null` and render exactly as before — the
 * marker gate exists so Tailwind's preflight reset can never leak into a story that styles
 * itself with its own <style> blocks.
 */
import type { StoryContent } from '@/lib/validation/atlas-schemas';

/** Root-wrapper attribute (`data-design="tw"`) that opts a story into the design system. */
export const STORY_DESIGN_ATTR = 'data-design';
export const STORY_DESIGN_VALUE = 'tw';

/** StoryContent plus the server-managed compiled stylesheet. */
export type CompiledCssStoryContent = StoryContent & { compiledCss?: string | null };

const MARKER_RE = /\bdata-design\s*=\s*(?:"tw"|'tw')/;

/** True when the story HTML opts into the design system (root marker present). */
export function hasDesignSystemMarker(html: string | null | undefined): boolean {
  return !!html && MARKER_RE.test(html);
}

const CLASS_ATTR_RE = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Stored attribute values are entity-escaped (escAttr) — decode before tokenizing. &amp; last. */
const decodeAttr = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * All class-attribute tokens in the HTML — the Tailwind candidate set.
 * Deduped and sorted so the compiled CSS is deterministic for a given document.
 */
export function extractClassCandidates(html: string): string[] {
  const tokens = new Set<string>();
  for (const m of html.matchAll(CLASS_ATTR_RE)) {
    for (const token of decodeAttr(m[1] ?? m[2] ?? '').split(/\s+/)) {
      if (token) tokens.add(token);
    }
  }
  return [...tokens].sort();
}
