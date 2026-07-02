/**
 * Story ⇄ jsx adapter (File Architecture v2).
 *
 * A jsx-backed story stores its body in the file's `jsx` field as HTML-ish static JSX:
 *
 *   <div class="story">
 *     <style>{`.story{ … CSS … }`}</style>
 *     <h1>Title</h1>
 *     <Question id={1017} />
 *   </div>
 *
 * - HTML tags are authored as lowercase JSX (class/style as plain string attributes).
 * - CSS goes in a `<style>` template-literal child so its `{ }` stay raw.
 * - `<Question id={…} />` embeds a question (or questionv2) file by id.
 *
 * `parseStoryJsx` compiles that to the story HTML the existing StoryView/AgentHtml
 * renders (Question → the `data-question-id` placeholder it already understands) plus the
 * embedded asset ids. `buildStoryJsx` is the reverse, for save round-trips.
 */
import { parseJsx } from '@/lib/jsx';
import type { JsxNode } from '@/lib/jsx';
import type { StoryContent } from '@/lib/types';
import { paramFromJsxAttrs, paramToPlaceholder, placeholdersToParamJsx } from './story-params';
import { inlineQuestionFromJsxAttrs, inlineQuestionToPlaceholder, placeholdersToInlineQuestionJsx } from './story-question';
import { numberFromJsxAttrs, numberToPlaceholder, placeholdersToNumberJsx } from './story-number';
import { immutableSet } from '@/lib/utils/immutable-collections';

const VOID_TAGS = immutableSet([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export interface StoryV2Parsed {
  html: string;
  assets: number[];
}

export type ParseStoryResult =
  | { ok: true; value: StoryV2Parsed }
  | { ok: false; error: string };

export function parseStoryJsx(jsx: string): ParseStoryResult {
  const r = parseJsx(jsx);
  if (!r.ok) return { ok: false, error: r.error };
  const assets: number[] = [];
  const html = r.nodes.map((n) => nodeToHtml(n, assets)).join('');
  return { ok: true, value: { html, assets: [...new Set(assets)] } };
}

/** A CSS dimension attr (width/height) from parsed jsx attrs → a plain string, or `def` if absent. */
function dimAttr(v: unknown, def: string): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).replace(/["']/g, '') : def;
}

function nodeToHtml(node: JsxNode, assets: number[]): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'expression') return node.value.static && typeof node.value.json === 'string' ? node.value.json : '';

  // <Question/> → the embed placeholder AgentHtml resolves to a live chart. Polymorphic:
  // `id={N}` embeds a saved question file; `query=…` embeds an inline story-local question.
  if (node.tag === 'Question') {
    const attrsMap: Record<string, unknown> = {};
    for (const a of node.attributes) if (a.value.static) attrsMap[a.name] = a.value.json;
    // Saved question by id (the agent's preferred path — reuse an existing file).
    if (typeof attrsMap.id === 'number') {
      const id = attrsMap.id;
      assets.push(id);
      // Flow-block contract: width defaults to 100% (responsive full-width), but the agent may
      // author an explicit px width; both are freely user-resizable. Height is an explicit px value.
      const w = dimAttr(attrsMap.width, '100%');
      const h = dimAttr(attrsMap.height, '430px');
      return `<div data-question-id="${id}" style="width:${w};height:${h}"></div>`;
    }
    // Inline story-local question (query/connection/viz/params live in the body).
    const inline = inlineQuestionFromJsxAttrs(attrsMap);
    return inline ? inlineQuestionToPlaceholder(inline) : '';
  }

  // <Number/> → an inline live figure (a <span>, not a chart card). id={N} or query={`…`}.
  if (node.tag === 'Number') {
    const attrsMap: Record<string, unknown> = {};
    for (const a of node.attributes) if (a.value.static) attrsMap[a.name] = a.value.json;
    const num = numberFromJsxAttrs(attrsMap);
    return num ? numberToPlaceholder(num) : '';
  }

  // <Param name=… /> → the shared-param placeholder AgentHtml mounts a ParameterInput at.
  if (node.tag === 'Param') {
    const attrsMap: Record<string, unknown> = {};
    for (const a of node.attributes) if (a.value.static) attrsMap[a.name] = a.value.json;
    const p = paramFromJsxAttrs(attrsMap);
    return p ? paramToPlaceholder(p) : '';
  }

  const attrs = node.attributes.map(attrToHtml).filter(Boolean).join(' ');
  const open = attrs ? `<${node.tag} ${attrs}>` : `<${node.tag}>`;
  if (VOID_TAGS.has(node.tag.toLowerCase())) return open;
  const children = node.children.map((c) => nodeToHtml(c, assets)).join('');
  return `${open}${children}</${node.tag}>`;
}

// JSX attribute names → their HTML equivalents. The agent authors *JSX*, so it naturally
// reaches for the React spellings (`className`, `htmlFor`); emitting those verbatim into the
// shadow-DOM HTML produces dead `classname`/`htmlfor` attributes and the CSS class selectors
// never match (story renders unstyled). Map them back to real HTML attribute names.
const JSX_ATTR_TO_HTML: Record<string, string> = { className: 'class', htmlFor: 'for' };

function attrToHtml(a: { name: string; value: { static: boolean; json?: unknown } }): string {
  if (!a.value.static) return '';
  const name = JSX_ATTR_TO_HTML[a.name] ?? a.name;
  const v = a.value.json;
  if (v === true) return name;
  if (v === false || v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number') return `${name}="${String(v).replace(/"/g, '&quot;')}"`;
  return ''; // object/array attribute values aren't meaningful in plain HTML
}

/**
 * Reverse of {@link parseStoryJsx} (best-effort, for save). Turns the story HTML back
 * into jsx: `data-question-id` embeds → `<Question id={…}/>`, `<style>` CSS wrapped in a
 * template literal, void tags self-closed. Round-trips agent-authored stories.
 */
export function buildStoryJsx(content: StoryContent): string {
  let html = content.story ?? '';
  // <style>…</style> → <style>{`…`}</style> so CSS `{ }` don't break jsx
  html = html.replace(/<style>([\s\S]*?)<\/style>/g, (_m, css: string) => `<style>{\`${css.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\`}</style>`);
  // <div data-question-id="N" style="width:…;height:…"></div> → <Question id={N} width=… height=… />
  // Surface the authored size back to the agent (and round-trip it losslessly).
  html = html.replace(/<div\s+data-question-id=["'](\d+)["']([^>]*)>\s*<\/div>/g, (_m, id: string, rest: string) => {
    const style = /style=["']([^"']*)["']/.exec(rest)?.[1] ?? '';
    const w = /(?:^|;)\s*width:\s*([^;]+)/.exec(style)?.[1]?.trim();
    const h = /(?:^|;)\s*height:\s*([^;]+)/.exec(style)?.[1]?.trim();
    const attrs = [`id={${id}}`];
    if (w) attrs.push(`width="${w}"`);
    if (h) attrs.push(`height="${h}"`);
    return `<Question ${attrs.join(' ')} />`;
  });
  // <div data-question-inline="…" …></div> → <Question query={`…`} connection=… viz=… params=… />
  html = placeholdersToInlineQuestionJsx(html);
  // <span data-number-inline="…"></span> → <Number id={N}|query={`…`} … />
  html = placeholdersToNumberJsx(html);
  // <div data-param-* …></div> → <Param name=… />
  html = placeholdersToParamJsx(html);
  // self-close void tags (jsx requires it): <br> → <br/>, <img …> → <img …/>
  html = html.replace(/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)((?:\s[^>]*)?)>/g, (_m, tag: string, rest: string) => `<${tag}${rest} />`);
  return html;
}
