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

// The single place a file type's specifics are bound to the generic converter: the `$defs` for
// schema resolution + the codec for `format:'jsx'` fields (the story body's <Question>/<Param>
// placeholder ⇄ inline-jsx round-trip). content-jsx itself stays file-type-agnostic.
const CTX: SchemaCtx = {
  defs: (atlasSchema as { $defs?: Record<string, JsonSchema> }).$defs ?? {},
  jsxField: {
    toJsx: (value) => buildStoryJsx({ story: value, assets: [] } as StoryContent),
    fromJsx: (inner) => { const p = parseStoryJsx(inner); return p.ok ? p.value.html : inner; },
  },
};

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
  return contentToJsx(content ?? {}, schemaFor(type), CTX);
}

export type MarkupToContentResult =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; error: string };

/** Parse agent markup back into the file's typed content. */
export function markupToContent(type: FileType, markup: string): MarkupToContentResult {
  const r = jsxToContent(markup, schemaFor(type), CTX);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, content: (r.value && typeof r.value === 'object' ? r.value : {}) as Record<string, unknown> };
}
