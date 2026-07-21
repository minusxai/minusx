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
import { escAttr } from './html-attr';
import { paramFromJsxAttrs, paramToPlaceholder, placeholdersToParamJsx } from './story-params';
import {
  inlineQuestionFromJsxAttrs, inlineQuestionToPlaceholder, placeholdersToInlineQuestionJsx,
  savedQuestionToPlaceholder, placeholdersToSavedQuestionJsx, vizEnvelopeFromAttr,
} from './story-question';
import { numberFromJsxAttrs, numberToPlaceholder, placeholdersToNumberJsx } from './story-number';
import { emitStoryComponent, reverseStoryComponents, STORY_COMPONENTS } from './story-components';
import { immutableSet } from '@/lib/utils/immutable-collections';

const VOID_TAGS = immutableSet([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Saved-file ids embedded in a NEW-format (`format:'jsx'`) story body: `<Question id={N}/>`
 * and `<Number id={N}/>` elements, read from the parsed JSX AST (the source is stored
 * verbatim — there is no placeholder HTML to regex). Mirrors the legacy
 * extractSavedQuestionIds/extractNumberQuestionIds reference flow. Best-effort: an
 * unparseable body yields no references.
 */
export function extractJsxEmbedIds(source: string | null | undefined): number[] {
  if (!source) return [];
  const r = parseJsx(source);
  if (!r.ok) return [];
  const ids: number[] = [];
  const walk = (n: JsxNode): void => {
    if (n.type !== 'element') return;
    if (n.tag === 'Question' || n.tag === 'Number') {
      const idAttr = n.attributes.find((a) => a.name === 'id' && a.value.static && typeof a.value.json === 'number');
      if (idAttr && idAttr.value.static) ids.push(idAttr.value.json as number);
    }
    n.children.forEach(walk);
  };
  r.nodes.forEach(walk);
  return [...new Set(ids)];
}

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

/**
 * Escape a decoded JSXText value for the stored HTML. acorn-jsx decodes entities in text
 * (`&lt;` → `<`), so emitting the value raw would plant a bare `<`/`&` in the stored HTML —
 * which buildStoryJsx then re-emits into the agent's markup, making the whole file unparseable
 * and every subsequent edit fail. `{`/`}` are worse still: a re-emitted raw brace opens a JSX
 * expression container mid-prose (acorn: "Expecting Unicode escape sequence \uXXXX" when a `\`
 * follows), locking the file out of ALL edits. Entities keep the render identical and the
 * round-trip stable.
 */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

function nodeToHtml(node: JsxNode, assets: number[], rawStrings = false): string {
  if (node.type === 'text') return escapeHtmlText(node.value);
  if (node.type === 'expression') {
    if (!node.value.static || typeof node.value.json !== 'string') return '';
    // A {`…`} template child is raw ONLY inside <style> (CSS braces must stay literal in the
    // stored HTML); in prose it's just text, and must be escaped like text or it poisons the file.
    return rawStrings ? node.value.json : escapeHtmlText(node.value.json);
  }

  // <Question/> → the embed placeholder AgentHtml resolves to a live chart. Polymorphic:
  // `id={N}` embeds a saved question file; `query=…` embeds an inline story-local question.
  if (node.tag === 'Question') {
    const attrsMap: Record<string, unknown> = {};
    for (const a of node.attributes) if (a.value.static) attrsMap[a.name] = a.value.json;
    // Saved question by id (the agent's preferred path — reuse an existing file). An optional
    // viz={V2 envelope} FULLY overrides the saved question's viz for this story (legacy-shaped
    // viz attrs are ignored here — overrides are envelope-only).
    if (typeof attrsMap.id === 'number') {
      const id = attrsMap.id;
      assets.push(id);
      const h = typeof attrsMap.height === 'string' || typeof attrsMap.height === 'number'
        ? String(attrsMap.height)
        : undefined;
      return savedQuestionToPlaceholder(id, h, vizEnvelopeFromAttr(attrsMap.viz));
    }
    // Inline story-local question (query|spreadsheet/connection/viz/params live in the body).
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

  // Design-system components (<Pill/>, <Card/>, <Grid/>, …) — compile-time only: a container
  // element with the curated Tailwind recipe + a data-c stamp for the reverse pass. Children
  // recurse through the normal pipeline, so embeds/components nest freely.
  if (STORY_COMPONENTS[node.tag]) {
    const attrsMap: Record<string, unknown> = {};
    for (const a of node.attributes) if (a.value.static) attrsMap[a.name] = a.value.json;
    const children = node.children.map((c) => nodeToHtml(c, assets)).join('');
    return emitStoryComponent(node.tag, attrsMap, children) ?? '';
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
  const children = node.children.map((c) => nodeToHtml(c, assets, node.tag === 'style')).join('');
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
  // Full entity escape (not just `"`): a raw `<`/`>` inside a stored attribute value breaks the
  // tag-boundary regexes/walkers over the stored HTML (and the jsx re-emit), so all four ride
  // as entities — the same set escAttr uses for the placeholder payload attributes.
  if (typeof v === 'string' || typeof v === 'number') return `${name}="${escAttr(String(v))}"`;
  return ''; // object/array attribute values aren't meaningful in plain HTML
}

/**
 * Escape stray `{`/`}`/`>` in the TEXT spans of stored HTML — outside tags and outside `<style>`
 * blocks (whose CSS must stay raw for the template-literal wrap below). New writes already
 * store these as entities ({@link escapeHtmlText}); this pass HEALS documents written before
 * that fix: one raw brace (JSX expression opener) or bare `>` ("Unexpected token `>`") in prose
 * makes the whole file unparseable, and every subsequent edit fails at the same position forever.
 */
function escapeBracesInText(html: string): string {
  let out = '';
  for (let i = 0; i < html.length; ) {
    if (/^<style[\s>]/i.test(html.slice(i, i + 7))) {
      const end = html.indexOf('</style>', i);
      const stop = end === -1 ? html.length : end + '</style>'.length;
      out += html.slice(i, stop); i = stop; continue;
    }
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      const stop = end === -1 ? html.length : end + 1;
      out += html.slice(i, stop); i = stop; continue;
    }
    const next = html.indexOf('<', i);
    const stop = next === -1 ? html.length : next;
    out += html.slice(i, stop).replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/>/g, '&gt;');
    i = stop;
  }
  return out;
}

/**
 * Reverse of {@link parseStoryJsx} (best-effort, for save). Turns the story HTML back
 * into jsx: `data-question-id` embeds → `<Question id={…}/>`, `<style>` CSS wrapped in a
 * template literal, void tags self-closed. Round-trips agent-authored stories.
 */
export function buildStoryJsx(content: StoryContent): string {
  // Heal raw `{`/`}` in prose FIRST (skips <style> and tag internals), so a legacy-poisoned
  // body becomes parseable markup again instead of failing every edit.
  let html = escapeBracesInText(content.story ?? '');
  // <style>…</style> → <style>{`…`}</style> so CSS `{ }` don't break jsx
  html = html.replace(/<style>([\s\S]*?)<\/style>/g, (_m, css: string) => `<style>{\`${css.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\`}</style>`);
  // <div data-question-id="N" …></div> → <Question id={N} viz=… height=… /> (override + height kept)
  html = placeholdersToSavedQuestionJsx(html);
  // <div data-question-inline="…" …></div> → <Question query={`…`} connection=… viz=… params=… />
  html = placeholdersToInlineQuestionJsx(html);
  // <span data-number-inline="…"></span> → <Number id={N}|query={`…`} … />
  html = placeholdersToNumberJsx(html);
  // <div data-param-* …></div> → <Param name=… />
  html = placeholdersToParamJsx(html);
  // data-c containers → design-system components (<Pill/>, <Card/>, …). After the placeholder
  // reversals, so embeds inside components are already jsx (their divs don't skew depth-matching).
  html = reverseStoryComponents(html);
  // self-close void tags (jsx requires it): <br> → <br/>, <img …> → <img …/>
  html = html.replace(/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)((?:\s[^>]*)?)>/g, (_m, tag: string, rest: string) => `<${tag}${rest} />`);
  return html;
}
