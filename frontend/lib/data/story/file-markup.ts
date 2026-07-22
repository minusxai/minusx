/**
 * File ⇄ agent-markup combiner (File Architecture v2).
 *
 * Turns a file's typed `content` into the JSX document the agent reads + edits, and parses
 * it back. `content` stays the canonical typed jsonb (renders / GUI / server query path are
 * untouched); this is purely the agent's escaped-JSON-free I/O surface.
 *
 * It is ONE uniform, schema-driven `content ⇄ jsx` conversion for every file type — objects
 * nest, arrays use `<item>`, scalars are typed by the schema, strings-with-`<` ride in
 * `{`…`}` leaves, and a `format:'jsx'` field (e.g. a story's HTML body) is emitted inline as
 * real elements. No per-file-type dialect; the file type only selects which `*Content`
 * schema drives the conversion (config types with no schema fall back to schemaless markup
 * with `type="…"` annotations).
 */
import { contentToJsx, jsxToContent, type SchemaCtx, type JsonSchema } from './content-jsx';
import { atlasSchema } from '@/lib/validation/atlas-json-schemas';
import type { FileType, StoryContent } from '@/lib/types';
import { buildStoryJsx, parseStoryJsx } from './story-v2';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { sanitizeStoryMarkupCss } from './banned-css';

const DEFS: Record<string, JsonSchema> = (atlasSchema as { $defs?: Record<string, JsonSchema> }).$defs ?? {};

// The single place a file type's specifics are bound to the generic converter: the `$defs` for
// schema resolution + the codec for `format:'jsx'` fields (the story body's <Question>/<Param>
// placeholder ⇄ inline-jsx round-trip). content-jsx itself stays file-type-agnostic.
const CTX: SchemaCtx = {
  defs: DEFS,
  jsxField: {
    toJsx: (value) => buildStoryJsx({ story: value, assets: [] } as StoryContent),
    fromJsx: (inner) => { const p = parseStoryJsx(inner); return p.ok ? p.value.html : inner; },
  },
};

// New-format (`format:'jsx'`) stories: the body IS the agent's shadcn JSX source — stored
// verbatim except for the banned-CSS strip (§4: position fixed/sticky + external-fetch
// constructs are removed from <style> blocks and inline styles at the save boundary; legacy
// stories go through CTX above and keep e.g. their @import fonts live). Validation runs
// against the shadcn registry names plus the explicit HTML-tag allowlist (Story_Design_V2 §2).
const JSX_STORY_CTX: SchemaCtx = {
  defs: DEFS,
  jsxField: {
    toJsx: (value) => value,
    fromJsx: (inner) => sanitizeStoryMarkupCss(inner),
    components: JSX_STORY_COMPONENT_NAMES,
    allowedHtmlTags: STORY_HTML_TAGS,
  },
};

const DATA_C_ATTR_RE = /<[^>]*\sdata-c\s*=/;

/**
 * True when a story's EXISTING STORED content is legacy (pre-shadcn HTML pipeline).
 * Derived EXCLUSIVELY from the stored content — never from incoming markup, so legacy-ness
 * cannot be forged to bypass the new-story validation: a non-`format:'jsx'` content whose
 * stored HTML carries a `data-c` attribute, or that already has a non-empty body, is legacy.
 * No existing content (a brand-new story) or `format:'jsx'` content is the new pipeline.
 */
export function isLegacyStoryContent(content: unknown): boolean {
  if (!content || typeof content !== 'object') return false;
  const c = content as { format?: unknown; story?: unknown };
  if (c.format === 'jsx') return false;
  const story = typeof c.story === 'string' ? c.story : '';
  return DATA_C_ATTR_RE.test(story) || story.trim() !== '';
}

/** The `*Content` JSON-Schema that drives conversion for a file type — undefined ⇒ schemaless. */
function schemaFor(type: FileType): JsonSchema {
  const def: Partial<Record<FileType, string>> = {
    question: 'QuestionContent',
    dashboard: 'DashboardContent',
    story: 'StoryContent',
    notebook: 'NotebookContent',
    // Context markup is schema-driven over the agent's flattened view (lib/context/context-agent-view.ts
    // shapes content into this shape before fileToMarkup; the fold reverses it on edit).
    context: 'ContextContent',
  };
  const name = def[type];
  return name ? CTX.defs[name] : undefined;
}

/** Project a file's typed content to the jsx markup the agent reads/edits. */
export function fileToMarkup(type: FileType, content: unknown): string {
  const jsxFormat = type === 'story' && !!content && typeof content === 'object'
    && (content as { format?: unknown }).format === 'jsx';
  return contentToJsx(content ?? {}, schemaFor(type), jsxFormat ? JSX_STORY_CTX : CTX);
}

export type MarkupToContentResult =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Parse agent markup back into the file's typed content.
 *
 * `existingContent` (the file's CURRENT stored content, when the file already exists) decides
 * a story's pipeline: legacy stored HTML keeps the old compile path unchanged; everything else
 * (new files, `format:'jsx'` files) validates against the shadcn registry and stores the JSX
 * source verbatim with `format:'jsx'` stamped. The flag is never derivable from the markup.
 */
export function markupToContent(type: FileType, markup: string, existingContent?: unknown): MarkupToContentResult {
  const jsxFormat = type === 'story' && !isLegacyStoryContent(existingContent);
  const r = jsxToContent(markup, schemaFor(type), jsxFormat ? JSX_STORY_CTX : CTX);
  if (!r.ok) return { ok: false, error: r.error };
  const content = (r.value && typeof r.value === 'object' ? r.value : {}) as Record<string, unknown>;
  if (jsxFormat) content.format = 'jsx';
  return { ok: true, content };
}
