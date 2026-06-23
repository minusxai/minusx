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

function nodeToHtml(node: JsxNode, assets: number[]): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'expression') return node.value.static && typeof node.value.json === 'string' ? node.value.json : '';

  // <Question id={…} /> → the embed placeholder AgentHtml resolves to a live chart.
  if (node.tag === 'Question') {
    const idAttr = node.attributes.find((a) => a.name === 'id');
    const id = idAttr?.value.static && typeof idAttr.value.json === 'number' ? idAttr.value.json : null;
    if (id == null) return '';
    assets.push(id);
    const hAttr = node.attributes.find((a) => a.name === 'height');
    const h = hAttr?.value.static && (typeof hAttr.value.json === 'string' || typeof hAttr.value.json === 'number')
      ? String(hAttr.value.json).replace(/["']/g, '')
      : '430px';
    return `<div data-question-id="${id}" style="width:100%;height:${h}"></div>`;
  }

  const attrs = node.attributes.map(attrToHtml).filter(Boolean).join(' ');
  const open = attrs ? `<${node.tag} ${attrs}>` : `<${node.tag}>`;
  if (VOID_TAGS.has(node.tag.toLowerCase())) return open;
  const children = node.children.map((c) => nodeToHtml(c, assets)).join('');
  return `${open}${children}</${node.tag}>`;
}

function attrToHtml(a: { name: string; value: { static: boolean; json?: unknown } }): string {
  if (!a.value.static) return '';
  const v = a.value.json;
  if (v === true) return a.name;
  if (v === false || v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number') return `${a.name}="${String(v).replace(/"/g, '&quot;')}"`;
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
  // <div data-question-id="N" …></div> → <Question id={N} />
  html = html.replace(/<div\s+data-question-id=["'](\d+)["'][^>]*>\s*<\/div>/g, (_m, id: string) => `<Question id={${id}} />`);
  // self-close void tags (jsx requires it): <br> → <br/>, <img …> → <img …/>
  html = html.replace(/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)((?:\s[^>]*)?)>/g, (_m, tag: string, rest: string) => `<${tag}${rest} />`);
  return html;
}
