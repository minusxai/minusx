/**
 * File ⇄ agent-markup combiner (File Architecture v2).
 *
 * The single place that turns a file's typed `content` into the markup the agent reads
 * and edits, and parses that markup back to `content`. `content` stays the canonical
 * typed jsonb (renders + GUI + server query path are untouched); this is purely the
 * agent's I/O projection — the agent never sees escaped JSON.
 *
 * Two dialects, chosen by file type:
 * - **jsx** (story, dashboard): the freeform/positional body projects to a `<jsx>…</jsx>`
 *   block; the remaining scalar metadata projects to `<props>…</props>`.
 * - **keyvalue** (everything else — question, notebook, connection, config, folder,
 *   context): the whole `content` projects to `<props>…</props>` as schema-driven XML.
 *
 * The file type's JSON Schema both validates and drives the keyvalue conversion.
 */
import { parseJsx, serializeJsx } from '@/lib/jsx';
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { propsToXml, propsFromElement, type SchemaCtx, type JsonSchema } from './keyvalue-xml';
import { atlasSchema } from '@/lib/validation/atlas-json-schemas';
import { buildStoryJsx, parseStoryJsx } from './story-v2';
import { dashboardToJsx, jsxToDashboard } from './dashboard-jsx';
import type { FileType } from '@/lib/types';

const CTX: SchemaCtx = { defs: (atlasSchema as { $defs?: Record<string, JsonSchema> }).$defs ?? {} };

/** Document types whose body is freeform/positional and projects to a `<jsx>` block. */
export const JSX_BODY_TYPES = new Set<FileType>(['story', 'dashboard']);

/** Props (the keyvalue half) JSON-Schema by file type — undefined ⇒ schemaless inference. */
function propsSchema(type: FileType): JsonSchema {
  const def: Partial<Record<FileType, string>> = { question: 'QuestionContent', notebook: 'NotebookContent' };
  const name = def[type];
  return name ? CTX.defs[name] : undefined;
}

/** For jsx-body types, the metadata (props) fields — the body fields are dropped (they live in jsx). */
function metadataProps(type: FileType, content: Record<string, unknown>): Record<string, unknown> {
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => content[k] != null).map((k) => [k, content[k]]));
  if (type === 'story') return pick(['description', 'colorMode', 'suggestedQuestions']);
  if (type === 'dashboard') return pick(['description', 'parameterValues']);
  return content;
}

function bodyToJsx(type: FileType, content: Record<string, unknown>): string {
  if (type === 'story') return buildStoryJsx(content as Parameters<typeof buildStoryJsx>[0]);
  if (type === 'dashboard') return dashboardToJsx(content);
  return '';
}

/** Project a file's typed content to the markup the agent reads/edits. */
export function fileToMarkup(type: FileType, content: unknown): string {
  const c = (content ?? {}) as Record<string, unknown>;
  const propsXml = propsToXml(metadataProps(type, c), propsSchema(type), 'props', CTX);
  if (JSX_BODY_TYPES.has(type)) {
    return `<jsx>\n${bodyToJsx(type, c)}\n</jsx>\n${propsXml}`;
  }
  return propsXml;
}

export type MarkupToContentResult =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; error: string };

/** Parse agent markup back into the file's typed content. */
export function markupToContent(type: FileType, markup: string): MarkupToContentResult {
  const parsed = parseJsx(markup);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const roots = parsed.nodes.filter((n): n is JsxElement => n.type === 'element');
  const propsEl = roots.find((r) => r.tag === 'props');
  const jsxEl = roots.find((r) => r.tag === 'jsx');

  // props half
  const propsVal = propsEl ? propsFromElement(propsEl, propsSchema(type), CTX) : {};
  const props = (propsVal && typeof propsVal === 'object' ? propsVal : {}) as Record<string, unknown>;

  if (!JSX_BODY_TYPES.has(type)) {
    if (!propsEl && roots.length > 0) {
      // Tolerate a bare root that isn't <props> (e.g. agent wrote <question>…).
      const alt = propsFromElement(roots[0], propsSchema(type), CTX);
      return { ok: true, content: (alt && typeof alt === 'object' ? alt : {}) as Record<string, unknown> };
    }
    return { ok: true, content: props };
  }

  // jsx-body half
  const bodyNodes: JsxNode[] = jsxEl ? jsxEl.children : [];
  const bodyJsx = serializeJsx(bodyNodes);
  if (type === 'story') {
    const r = parseStoryJsx(bodyJsx);
    if (!r.ok) return { ok: false, error: `Invalid story jsx: ${r.error}` };
    return { ok: true, content: { ...props, story: r.value.html, assets: r.value.assets.map((id) => ({ type: 'question', id })) } };
  }
  if (type === 'dashboard') {
    const d = jsxToDashboard(bodyNodes as Parameters<typeof jsxToDashboard>[0]);
    return { ok: true, content: { ...props, assets: d.assets, layout: d.layout } };
  }
  return { ok: true, content: props };
}
