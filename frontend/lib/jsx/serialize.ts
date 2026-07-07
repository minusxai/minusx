/**
 * Serialize a static-JSX AST back to jsx text — the inverse of {@link parseJsx}.
 *
 * The `jsx` body of a document file is stored as its parsed AST (jsonb); the agent reads
 * and edits it as jsx text, so we need a faithful AST→text serializer. Round-trips with
 * parseJsx: `parseJsx(serializeJsx(parseJsx(src).nodes))` is stable (formatting may
 * normalize, but structure + text/SQL/CSS leaves are preserved).
 *
 * - string attribute value → `name="value"`; any other JSON literal → `name={<json>}`.
 * - text child → raw; static-string expression child → a template literal `{`…`}` (so
 *   SQL/CSS keep `<`, `>`, `{` raw); other static expression child → `{<json>}`.
 */
import type { JsxNode, JsxElement, JsxAttribute } from './types';

/**
 * Attribute-string escaping — the inverse of the parser's entity decoding, like {@link escapeText}
 * but for the attribute-value position. JSX attribute strings do NOT process backslash escapes, so
 * emitting a value with JSON.stringify (`style="font-family: \"X\""`) terminates the attribute at
 * the first `\"` and the stray `\` fails the whole-document parse ("Expecting Unicode escape
 * sequence \uXXXX") — locking the file out of every subsequent edit. Entities are what acorn-jsx
 * actually decodes in attribute values, so they round-trip exactly.
 */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attrToSource(a: JsxAttribute): string {
  if (!a.value.static) return a.value.source ? `${a.name}={${a.value.source}}` : a.name;
  const json = a.value.json;
  if (typeof json === 'string') return `${a.name}="${escapeAttr(json)}"`;
  if (json === true) return a.name; // boolean shorthand
  return `${a.name}={${JSON.stringify(json)}}`;
}

function rawTemplate(s: string): string {
  return `{\`${s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`}`;
}

/**
 * Text-node escaping — the inverse of the parser's entity decoding. acorn-jsx DECODES entities
 * in JSXText (`&lt;` → `<`), so emitting the value raw produces unparseable jsx whenever the
 * text contains `<`, `{`, or `}` (and `&` would silently re-decode a literal `&lt;`). Escaping
 * these keeps parse(serialize(nodes)) stable for every text value.
 */
function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;') // acorn-jsx rejects a raw `>` in JSXText ("Unexpected token `>`")
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

function nodeToSource(node: JsxNode): string {
  if (node.type === 'text') return escapeText(node.value);
  if (node.type === 'expression') {
    if (node.value.static) {
      return typeof node.value.json === 'string' ? rawTemplate(node.value.json) : `{${JSON.stringify(node.value.json)}}`;
    }
    return `{${node.source}}`;
  }
  const el = node as JsxElement;
  const attrs = el.attributes.map(attrToSource).join(' ');
  const open = attrs ? `${el.tag} ${attrs}` : el.tag;
  if (el.selfClosing && el.children.length === 0) return `<${open} />`;
  const inner = el.children.map(nodeToSource).join('');
  return `<${open}>${inner}</${el.tag}>`;
}

/** Serialize an AST (list of root nodes) to jsx text. */
export function serializeJsx(nodes: JsxNode[]): string {
  return nodes.map(nodeToSource).join('');
}
