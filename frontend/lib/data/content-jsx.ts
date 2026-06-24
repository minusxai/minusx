/**
 * Schema-driven content ⇄ jsx converter (File Architecture v2).
 *
 * A file's typed `content` (the jsonb — QuestionContent, ConnectionContent, …) is projected
 * to/from a JSX document so the agent edits clean markup instead of escaped JSON. It is all
 * JSX — the same `lib/jsx` engine parses + serialises it; there is no separate "XML".
 *
 * The schema (TypeBox `*Content` → JSON Schema) drives everything:
 * - object        → nested `<tag>…children…</tag>`
 * - array         → `<tag>` with repeated `<item>` children
 * - scalar        → `<tag>value</tag>`; a string containing <,>,{,`,newline rides in a raw
 *                   template-literal child `<tag>{`…`}</tag>` (so SQL with `x < 5` stays raw)
 * - `format:'jsx'`→ the field's value IS markup: emitted INLINE as real jsx elements
 *                   (`<story><div>…<Question id={5}/>…</div></story>`) and parsed back
 * - schemaless    → for config types with no schema, non-string scalars (and
 *                   ambiguous numeric/boolean strings) carry a `type="…"` attribute so they
 *                   round-trip losslessly
 *
 * Top level emits the content object's FIELDS as sibling elements (no wrapper).
 */
import { parseJsx, serializeJsx } from '@/lib/jsx';
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { buildStoryJsx, parseStoryJsx } from './story-v2';

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
  for (let i = 0; i < 20 && s; i++) {
    if (s.$ref) { s = ctx.defs[String(s.$ref).split('/').pop() as string]; continue; }
    if (Array.isArray(s.anyOf)) {
      const nonNull = s.anyOf.find((b: JsonSchema) => b && b.type !== 'null');
      if (nonNull) { s = nonNull; continue; }
    }
    break;
  }
  return s;
}

const pad = (d: number) => '  '.repeat(d);
const isJsxField = (s: JsonSchema): boolean => !!s && s.format === 'jsx';

/** A string element body: raw template-literal child when it contains jsx-significant chars. */
function strChild(s: string): string {
  if (/[<>&{`\n]/.test(s)) {
    return `{\`${s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`}`;
  }
  return s;
}

// ── content → jsx ──────────────────────────────────────────────────────────

/** Schemaless scalars carry a `type="…"` so they parse back to the right JS type. */
function schemalessTypeAttr(value: string | number | boolean): string {
  if (typeof value === 'number') return ' type="number"';
  if (typeof value === 'boolean') return ' type="boolean"';
  // A string that LOOKS numeric/boolean must be pinned, or it would infer wrong on the way back.
  if (value === 'true' || value === 'false' || (value !== '' && /^-?\d+(\.\d+)?$/.test(value))) return ' type="string"';
  return '';
}

function fieldToJsx(tag: string, value: unknown, schema: JsonSchema, ctx: SchemaCtx, depth: number): string {
  if (value == null) return '';
  const s = unwrap(schema, ctx);
  const p = pad(depth);

  // jsx field — the value is markup; emit it inline as real elements.
  if (isJsxField(s) && typeof value === 'string') {
    return `${p}<${tag}>${buildStoryJsx({ story: value, assets: [] } as Parameters<typeof buildStoryJsx>[0])}</${tag}>`;
  }

  const isObj = typeof value === 'object' && !Array.isArray(value);
  if ((s && s.type === 'object' && s.properties) || (!s && isObj)) {
    const v = value as Record<string, unknown>;
    const keys = s && s.properties ? Object.keys(s.properties) : Object.keys(v);
    const inner = keys
      .map((k) => fieldToJsx(k, v[k], s && s.properties ? s.properties[k] : undefined, ctx, depth + 1))
      .filter(Boolean).join('\n');
    return inner ? `${p}<${tag}>\n${inner}\n${p}</${tag}>` : `${p}<${tag}/>`;
  }

  if ((s && s.type === 'array' && s.items) || (!s && Array.isArray(value))) {
    const items = (Array.isArray(value) ? value : [])
      .map((el) => fieldToJsx('item', el, s && s.items ? s.items : undefined, ctx, depth + 1))
      .filter(Boolean).join('\n');
    return items ? `${p}<${tag}>\n${items}\n${p}</${tag}>` : `${p}<${tag}/>`;
  }

  const schemaScalar = s && (s.type === 'string' || s.type === 'number' || s.type === 'integer' || s.type === 'boolean');
  const inferScalar = !s && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
  if (schemaScalar || inferScalar) {
    const text = typeof value === 'string' ? strChild(value) : String(value);
    const attr = s ? '' : schemalessTypeAttr(value as string | number | boolean);
    return `${p}<${tag}${attr}>${text}</${tag}>`;
  }

  // Record / Unknown / unpinned union → JSON-literal escape hatch (guaranteed round-trip).
  return `${p}<${tag}>{${JSON.stringify(value)}}</${tag}>`;
}

/** Project typed content to a jsx document — the object's fields as sibling top-level elements. */
export function contentToJsx(value: unknown, schema: JsonSchema, ctx: SchemaCtx): string {
  const s = unwrap(schema, ctx);
  const v = (value ?? {}) as Record<string, unknown>;
  const keys = s && s.properties ? Object.keys(s.properties) : Object.keys(v);
  return keys
    .map((k) => fieldToJsx(k, v[k], s && s.properties ? s.properties[k] : undefined, ctx, 0))
    .filter(Boolean).join('\n');
}

// ── jsx → content ──────────────────────────────────────────────────────────

function coerceTyped(text: string, type: string): unknown {
  if (type === 'number' || type === 'integer') return Number(text);
  if (type === 'boolean') return text === 'true';
  return text;
}

function coerce(text: string, s: JsonSchema, typeAttr: string | undefined): unknown {
  if (s) {
    if (s.type === 'number' || s.type === 'integer') return Number(text);
    if (s.type === 'boolean') return text === 'true';
    return text; // string (or enum)
  }
  if (typeAttr) return coerceTyped(text, typeAttr);
  // schemaless, unannotated: infer
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text !== '' && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function textOf(node: JsxElement): string {
  return node.children.filter((c): c is Extract<JsxNode, { type: 'text' }> => c.type === 'text').map((c) => c.value).join('');
}

function elementToValue(node: JsxElement, schema: JsonSchema, ctx: SchemaCtx): unknown {
  const s = unwrap(schema, ctx);

  // jsx field — serialise its inline elements back to the stored markup string.
  if (isJsxField(s)) {
    const inner = serializeJsx(node.children).trim();
    const parsed = parseStoryJsx(inner);
    return parsed.ok ? parsed.value.html : inner;
  }

  // A static expression child handles raw strings (`{`SQL`}`) and the JSON-literal escape hatch.
  const expr = node.children.find((c) => c.type === 'expression' && c.value.static);
  if (expr && expr.type === 'expression' && expr.value.static) {
    // Non-string JSON literals (Record/array/object escape hatch, e.g. `{{"limit":"5"}}`)
    // already carry the right shape — return them as-is. Only scalar string leaves
    // (`{`SQL`}`) need schema-driven coercion.
    if (typeof expr.value.json !== 'string') return expr.value.json;
    return s ? coerce(expr.value.json, s, undefined) : expr.value.json;
  }

  const typeAttr = node.attributes.find((a) => a.name === 'type' && a.value.static && typeof a.value.json === 'string');
  const typeName = typeAttr && typeAttr.value.static ? String(typeAttr.value.json) : undefined;

  // schemaless empty self-closing `<tag/>` → [] (matches the empty-array/object emit form).
  if (!s && !typeName && node.selfClosing && node.children.length === 0) return [];

  const childEls = node.children.filter((c): c is JsxElement => c.type === 'element');
  const itemEls = childEls.filter((c) => c.tag === 'item');

  if ((s && s.type === 'array' && s.items) || (!s && itemEls.length > 0 && itemEls.length === childEls.length)) {
    return itemEls.map((c) => elementToValue(c, s && s.items ? s.items : undefined, ctx));
  }

  if ((s && s.type === 'object' && s.properties) || (!s && childEls.length > 0)) {
    const obj: Record<string, unknown> = {};
    for (const child of childEls) {
      if (s && s.properties && !(child.tag in s.properties)) continue;
      obj[child.tag] = elementToValue(child, s && s.properties ? s.properties[child.tag] : undefined, ctx);
    }
    return obj;
  }

  return coerce(textOf(node).trim(), s, typeName);
}

export type JsxToContentResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Parse a jsx document back to typed content (top-level elements = the object's fields). */
export function jsxToContent(jsx: string, schema: JsonSchema, ctx: SchemaCtx): JsxToContentResult {
  const parsed = parseJsx(jsx);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const s = unwrap(schema, ctx);
  const obj: Record<string, unknown> = {};
  for (const root of parsed.nodes) {
    if (root.type !== 'element') continue;
    if (s && s.properties && !(root.tag in s.properties)) continue;
    obj[root.tag] = elementToValue(root, s && s.properties ? s.properties[root.tag] : undefined, ctx);
  }
  return { ok: true, value: obj };
}
