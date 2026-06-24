/**
 * Schema-driven keyvalue ⇄ XML converter (File Architecture v2).
 *
 * A file's structured `props` (the typed `content` — QuestionContent, ConnectionContent,
 * …) is projected to/from an XML-ish markup so the agent edits clean angle-bracket text
 * instead of escaped JSON. The file type's JSON Schema (derived from the TypeBox
 * `*Content` definitions) does double duty: it VALIDATES the value and DRIVES the
 * conversion — which fields nest, which are arrays, and the scalar type to coerce to.
 *
 * Conventions:
 * - object  → `<tag>` with one child element per property (schema property order)
 * - array   → `<tag>` with repeated `<item>` children
 * - string  → `<tag>text</tag>`, or `<tag>{`raw`}</tag>` when it contains <,>,&,{,` or a
 *             newline (so SQL with `WHERE x < 5` survives without escaping)
 * - number / integer / boolean → `<tag>value</tag>` (coerced back via the schema)
 * - anything the schema doesn't pin down (Record, Unknown, complex unions) → a JSON
 *   literal expression child `<tag>{ … }</tag>` — a guaranteed round-trip escape hatch.
 *
 * The same static-JSX engine (`parseJsx`) parses the markup back, so XML here is just a
 * keyvalue-shaped subset of the jsx grammar.
 */
import { parseJsx } from '@/lib/jsx';
import type { JsxElement, JsxNode } from '@/lib/jsx';

// JSON Schema is structurally dynamic; we walk it untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonSchema = any;

export interface SchemaCtx {
  /** $defs for `$ref` resolution (e.g. atlasSchema.$defs). */
  defs: Record<string, JsonSchema>;
}

/** Resolve `$ref` and unwrap a Nullable (`anyOf: [T, null]`) to its underlying schema. */
function unwrap(schema: JsonSchema, ctx: SchemaCtx): JsonSchema {
  let s = schema;
  // Resolve refs / nullable unions until we reach a concrete schema (bounded loop).
  for (let i = 0; i < 20 && s; i++) {
    if (s.$ref) {
      const name = String(s.$ref).split('/').pop() as string;
      s = ctx.defs[name];
      continue;
    }
    if (Array.isArray(s.anyOf)) {
      const nonNull = s.anyOf.find((b: JsonSchema) => b && b.type !== 'null');
      if (nonNull) { s = nonNull; continue; }
    }
    break;
  }
  return s;
}

const pad = (d: number) => '  '.repeat(d);

/** Encode a string as element text, switching to a raw template-literal child when needed. */
function strChild(s: string): string {
  if (/[<>&{`\n]/.test(s)) {
    const esc = s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    return `{\`${esc}\`}`;
  }
  return s;
}

function valueToXml(tag: string, value: unknown, schema: JsonSchema, ctx: SchemaCtx, depth: number): string {
  if (value == null) return ''; // omit absent / null
  const s = unwrap(schema, ctx);
  const p = pad(depth);

  // Object — schema-driven property order when available, else the value's own keys
  // (schemaless mode, for config types that have no JSON schema).
  const isObj = value !== null && typeof value === 'object' && !Array.isArray(value);
  if ((s && s.type === 'object' && s.properties) || (!s && isObj)) {
    const v = value as Record<string, unknown>;
    const keys = s && s.properties ? Object.keys(s.properties) : Object.keys(v);
    const inner = keys
      .map((k) => valueToXml(k, v[k], s && s.properties ? s.properties[k] : undefined, ctx, depth + 1))
      .filter(Boolean)
      .join('\n');
    return inner ? `${p}<${tag}>\n${inner}\n${p}</${tag}>` : `${p}<${tag}/>`;
  }

  if ((s && s.type === 'array' && s.items) || (!s && Array.isArray(value))) {
    const items = (Array.isArray(value) ? value : [])
      .map((el) => valueToXml('item', el, s && s.items ? s.items : undefined, ctx, depth + 1))
      .filter(Boolean)
      .join('\n');
    return items ? `${p}<${tag}>\n${items}\n${p}</${tag}>` : `${p}<${tag}/>`;
  }

  // Scalar — known primitive type, or inferred (string / number / boolean) when schemaless.
  const scalarType = s && (s.type === 'string' || s.type === 'number' || s.type === 'integer' || s.type === 'boolean');
  if (scalarType || (!s && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))) {
    const text = typeof value === 'string' ? strChild(value) : String(value);
    return `${p}<${tag}>${text}</${tag}>`;
  }

  // Fallback (Record / Unknown / unpinned union): JSON-literal expression child.
  return `${p}<${tag}>{${JSON.stringify(value)}}</${tag}>`;
}

/** Project a typed `props` value to XML markup. `rootTag` is usually the file type name. */
export function propsToXml(value: unknown, schema: JsonSchema, rootTag: string, ctx: SchemaCtx): string {
  return valueToXml(rootTag, value ?? {}, schema, ctx, 0);
}

function coerce(json: unknown, s: JsonSchema): unknown {
  if (s) {
    if (s.type === 'number' || s.type === 'integer') return typeof json === 'number' ? json : Number(json);
    if (s.type === 'boolean') return typeof json === 'boolean' ? json : json === 'true';
    if (s.type === 'string') return typeof json === 'string' ? json : String(json);
    return json;
  }
  // Schemaless: infer scalar type from the text (number-looking → number, true/false → bool).
  if (typeof json !== 'string') return json;
  if (json === 'true') return true;
  if (json === 'false') return false;
  if (json !== '' && /^-?\d+(\.\d+)?$/.test(json)) return Number(json);
  return json;
}

function textOf(node: JsxElement): string {
  return node.children.filter((c): c is Extract<JsxNode, { type: 'text' }> => c.type === 'text').map((c) => c.value).join('');
}

function elementToValue(node: JsxElement, schema: JsonSchema, ctx: SchemaCtx): unknown {
  const s = unwrap(schema, ctx);

  // A static expression child handles both raw strings (`{`SQL`}`) and the JSON-literal
  // fallback ({ … }) — always honored first so any fallback round-trips exactly.
  const expr = node.children.find((c) => c.type === 'expression' && c.value.static);
  if (expr && expr.type === 'expression' && expr.value.static) return coerce(expr.value.json, s);

  // Schemaless empty self-closing element `<tag/>` → [] (propsToXml emits `<tag/>` for an
  // empty array/object; an empty string is `<tag></tag>`). Without this, an empty array
  // round-trips to "" and editFileStr's merge would clobber the real [] (e.g. a context
  // file's derived fullSchema/docs arrays).
  if (!s && node.selfClosing && node.children.length === 0) return [];

  const childEls = node.children.filter((c): c is JsxElement => c.type === 'element');
  const itemEls = childEls.filter((c) => c.tag === 'item');

  // Array — schema says array, or (schemaless) the element only has <item> children.
  if ((s && s.type === 'array' && s.items) || (!s && itemEls.length > 0 && itemEls.length === childEls.length)) {
    return itemEls.map((c) => elementToValue(c, s && s.items ? s.items : undefined, ctx));
  }

  // Object — schema says object, or (schemaless) the element has named child elements.
  if ((s && s.type === 'object' && s.properties) || (!s && childEls.length > 0)) {
    const obj: Record<string, unknown> = {};
    for (const child of childEls) {
      if (s && s.properties && !(child.tag in s.properties)) continue;
      obj[child.tag] = elementToValue(child, s && s.properties ? s.properties[child.tag] : undefined, ctx);
    }
    return obj;
  }

  return coerce(textOf(node).trim(), s);
}

/** Parse an already-extracted props element (used by the file-markup combiner). */
export function propsFromElement(el: JsxElement, schema: JsonSchema, ctx: SchemaCtx): unknown {
  return elementToValue(el, schema, ctx);
}

export type XmlToPropsResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Parse XML markup back to a typed `props` value, using the schema to coerce scalars. */
export function xmlToProps(xml: string, schema: JsonSchema, ctx: SchemaCtx): XmlToPropsResult {
  const parsed = parseJsx(xml);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const root = parsed.nodes.find((n): n is JsxElement => n.type === 'element');
  if (!root) return { ok: false, error: 'props XML must have a single root element' };
  return { ok: true, value: elementToValue(root, schema, ctx) };
}
