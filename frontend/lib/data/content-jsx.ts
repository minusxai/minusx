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
import { parseJsx, serializeJsx, validateJsxSource } from '@/lib/jsx';
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { JSX_COMPONENT_NAMES } from '@/lib/jsx/components';

/** Thrown by a jsx field that fails the static-JSX security rules; surfaced as a parse error. */
class JsxFieldError extends Error {}

// JSON Schema is structurally dynamic; we walk it untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonSchema = any;

export interface SchemaCtx {
  /** $defs for `$ref` resolution (e.g. atlasSchema.$defs). */
  defs: Record<string, JsonSchema>;
  /**
   * Codec for a `format:'jsx'` field (e.g. a story body): the field's stored string ⇄ the inline
   * jsx that represents it. Injected by the caller (`file-markup` wires the story-v2 codec) so this
   * converter stays file-type-agnostic — it never imports a specific file type's logic. When absent,
   * a jsx field degrades to a plain string leaf.
   */
  jsxField?: {
    /** stored content string → inline jsx (placed inside the field's tag). */
    toJsx(value: string): string;
    /** inline jsx (already security-validated) → stored content string. */
    fromJsx(inner: string): string;
  };
}

/**
 * Resolve `$ref` and unwrap a Nullable (`anyOf: [T, null]`) to its underlying schema.
 * A genuine multi-branch union (e.g. `FileReference | InlineAsset`, `Integer | String`) is
 * left intact — it can't collapse to one schema; `unionBranches` resolves it per-value instead.
 */
function unwrap(schema: JsonSchema, ctx: SchemaCtx): JsonSchema {
  let s = schema;
  for (let i = 0; i < 20 && s; i++) {
    if (s.$ref) { s = ctx.defs[String(s.$ref).split('/').pop() as string]; continue; }
    if (Array.isArray(s.anyOf)) {
      const nonNull = s.anyOf.filter((b: JsonSchema) => b && b.type !== 'null');
      if (nonNull.length === 1) { s = nonNull[0]; continue; } // Nullable(T) → T
      break; // multi-branch union: keep as-is, resolved per-value/-node by the caller
    }
    break;
  }
  return s;
}

/** The non-null branches of a genuine multi-branch union (≥2), each `$ref`/Nullable-resolved; else null. */
function unionBranches(s: JsonSchema, ctx: SchemaCtx): JsonSchema[] | null {
  if (!s || !Array.isArray(s.anyOf)) return null;
  const nonNull = s.anyOf.filter((b: JsonSchema) => b && b.type !== 'null');
  return nonNull.length > 1 ? nonNull.map((b: JsonSchema) => unwrap(b, ctx)) : null;
}

/** A property schema's `const`/`enum` allowed-values, used to discriminate object unions; else null. */
function narrowedValues(propSchema: JsonSchema): unknown[] | null {
  if (!propSchema) return null;
  if ('const' in propSchema) return [propSchema.const];
  if (Array.isArray(propSchema.enum)) return propSchema.enum;
  return null;
}

/** Pick the union branch for a JS value: discriminate objects by their const/enum props, scalars by JS type. */
function branchForValue(branches: JsonSchema[], value: unknown): JsonSchema {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const objBranches = branches.filter((b) => b && b.type === 'object' && b.properties);
    const match = objBranches.find((b) =>
      Object.entries(b.properties as Record<string, JsonSchema>).every(([k, ps]) => {
        const allowed = narrowedValues(ps);
        return !allowed || allowed.includes(v[k]);
      })
    );
    return match ?? objBranches[0] ?? branches[0];
  }
  const t = typeof value;
  return (
    branches.find((b) => b && (
      (t === 'number' && (b.type === 'number' || b.type === 'integer')) ||
      (t === 'boolean' && b.type === 'boolean') ||
      (t === 'string' && b.type === 'string')
    )) ?? branches[0]
  );
}

/** Parse-side object-union discrimination: read the narrowing child (e.g. `<type>`) and match a branch. */
function branchForNode(branches: JsonSchema[], childEls: JsxElement[]): JsonSchema | null {
  const objBranches = branches.filter((b) => b && b.type === 'object' && b.properties);
  const discKeys = new Set<string>();
  for (const b of objBranches) {
    for (const [k, ps] of Object.entries(b.properties as Record<string, JsonSchema>)) {
      if (narrowedValues(ps)) discKeys.add(k);
    }
  }
  for (const k of discKeys) {
    const child = childEls.find((c) => c.tag === k);
    if (!child) continue;
    const text = textOf(child).trim();
    const match = objBranches.find((b) => {
      const allowed = narrowedValues((b.properties as Record<string, JsonSchema>)[k]);
      return allowed ? allowed.includes(text) : false;
    });
    if (match) return match;
  }
  return null;
}

/** Coerce a scalar leaf against a scalar union (e.g. `Integer | String`) — NaN-safe (keeps strings). */
function coerceUnionScalar(text: string, branches: JsonSchema[]): unknown {
  const hasNum = branches.some((b) => b.type === 'number' || b.type === 'integer');
  const hasStr = branches.some((b) => b.type === 'string');
  const hasBool = branches.some((b) => b.type === 'boolean');
  if (hasBool && (text === 'true' || text === 'false')) return text === 'true';
  if (hasNum && text !== '' && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (hasStr) return text;
  if (hasNum) { const n = Number(text); return Number.isNaN(n) ? text : n; }
  return text;
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

  // Multi-branch union (e.g. assets' FileReference|InlineAsset, layout id Integer|String) —
  // re-emit against the branch this value matches, so the right properties/types are used.
  const branches = unionBranches(s, ctx);
  if (branches) return fieldToJsx(tag, value, branchForValue(branches, value), ctx, depth);

  // jsx field — the value is markup; emit it inline as real elements (via the injected codec).
  if (isJsxField(s) && typeof value === 'string' && ctx.jsxField) {
    return `${p}<${tag}>${ctx.jsxField.toJsx(value)}</${tag}>`;
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

  // Multi-branch union: object node → discriminate by its narrowing child (e.g. <type>) and
  // re-parse against that branch; scalar node → NaN-safe coercion across the branch types.
  const branches = unionBranches(s, ctx);
  if (branches) {
    const childEls = node.children.filter((c): c is JsxElement => c.type === 'element');
    if (childEls.length > 0) {
      const branch = branchForNode(branches, childEls) ?? branches.find((b) => b.type === 'object') ?? branches[0];
      return elementToValue(node, branch, ctx);
    }
    const exprLeaf = node.children.find((c) => c.type === 'expression' && c.value.static);
    const text = exprLeaf && exprLeaf.type === 'expression' && exprLeaf.value.static && typeof exprLeaf.value.json === 'string'
      ? exprLeaf.value.json : textOf(node).trim();
    return coerceUnionScalar(text, branches);
  }

  // jsx field — serialise its inline elements back to the stored string (via the injected codec).
  // The static-JSX security rules (no <script>/event-handlers/javascript: URLs, only registered
  // components) are enforced HERE — generic to any jsx field — before it reaches the render path.
  if (isJsxField(s)) {
    const inner = serializeJsx(node.children).trim();
    const errs = validateJsxSource(inner, JSX_COMPONENT_NAMES);
    if (errs.length > 0) throw new JsxFieldError(errs.map((e) => e.message).join('; '));
    return ctx.jsxField ? ctx.jsxField.fromJsx(inner) : inner;
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
  const dropped: string[] = [];
  try {
    for (const root of parsed.nodes) {
      if (root.type !== 'element') continue;
      if (s && s.properties && !(root.tag in s.properties)) { dropped.push(root.tag); continue; }
      obj[root.tag] = elementToValue(root, s && s.properties ? s.properties[root.tag] : undefined, ctx);
    }
  } catch (e) {
    if (e instanceof JsxFieldError) return { ok: false, error: e.message };
    throw e;
  }
  // Guard the silent-drop trap: top-level tags that aren't schema fields are skipped, so markup made
  // entirely of unrecognized top-level elements parses to `{}` and every downstream consumer reports a
  // hollow success (e.g. EditFile: "1 FILE EDIT" but no content change → blank story). If we dropped
  // element(s) AND recognized nothing, that's not an empty document — it's un-fielded markup; fail
  // loudly so the agent gets a truthful signal instead of a no-op success.
  if (dropped.length > 0 && Object.keys(obj).length === 0) {
    const fields = s && s.properties ? Object.keys(s.properties) : [];
    return {
      ok: false,
      error: `No recognized top-level field element${dropped.length > 1 ? 's' : ''}: found <${dropped.join('>, <')}>. `
        + `Content fields must be top-level elements named one of: ${fields.length ? fields.map((f) => `<${f}>`).join(', ') : '(none)'}. `
        + `Wrap the body in the matching field element (e.g. a story body goes inside <story>…</story>).`,
    };
  }
  return { ok: true, value: obj };
}
