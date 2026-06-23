/**
 * Parse a static-JSX `jsx` source into the normalized AST ({@link types}).
 *
 * Uses acorn + acorn-jsx (isomorphic — Node + browser). The source is wrapped in a
 * `<>…</>` fragment so multiple root nodes are allowed; positions are offset-corrected
 * back to the original source. Attribute / child `{…}` expressions are evaluated to
 * JSON literals where possible; non-static expressions are RECORDED (not thrown) so
 * {@link validateJsx} can reject them with a precise message. Only acorn syntax errors
 * yield `{ ok:false }`.
 */
import { Parser } from 'acorn';
import jsxPlugin from 'acorn-jsx';
import type { JsxNode, JsxElement, JsxAttribute, JsxExpression, StaticValue, JsonValue, ParseResult } from './types';

const JsxParser = Parser.extend(jsxPlugin());
const WRAP_OPEN = '<>';
const OFFSET = WRAP_OPEN.length; // positions in the wrapped source are shifted by this

// Set per parse() call (synchronous, single-threaded — safe). Used to slice raw source.
let _src = '';

export function parseJsx(source: string): ParseResult {
  const wrapped = `${WRAP_OPEN}${source}</>`;
  _src = wrapped;
  let fragment: { type: string; children?: unknown[] };
  try {
    fragment = JsxParser.parseExpressionAt(wrapped, 0, { ecmaVersion: 'latest' }) as never;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const rawChildren = fragment.type === 'JSXFragment' ? (fragment.children ?? []) : [fragment];
    return { ok: true, nodes: normalizeChildren(rawChildren as AnyNode[]) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Internals (acorn AST nodes are untyped here — kept local)
// ---------------------------------------------------------------------------

type AnyNode = { type: string; start: number; end: number; [k: string]: unknown };

const span = (n: AnyNode) => ({ start: n.start - OFFSET, end: n.end - OFFSET });
const rawOf = (n: AnyNode) => _src.slice(n.start, n.end);

function normalizeChildren(raw: AnyNode[]): JsxNode[] {
  const out: JsxNode[] = [];
  for (const c of raw) {
    if (c.type === 'JSXFragment') { out.push(...normalizeChildren((c.children as AnyNode[]) ?? [])); continue; }
    const n = normalizeNode(c);
    if (n) out.push(n);
  }
  return out;
}

function normalizeNode(node: AnyNode): JsxNode | null {
  switch (node.type) {
    case 'JSXElement': return normalizeElement(node);
    case 'JSXText': return { type: 'text', value: node.value as string, ...span(node) };
    case 'JSXExpressionContainer': return normalizeExpressionChild(node);
    default: return null;
  }
}

function normalizeElement(node: AnyNode): JsxElement {
  const opening = node.openingElement as AnyNode;
  const tag = jsxNameToString(opening.name as AnyNode);
  const attributes: JsxAttribute[] = [];
  for (const a of (opening.attributes as AnyNode[]) ?? []) {
    if (a.type === 'JSXSpreadAttribute') {
      attributes.push({ name: '...', value: { static: false, exprType: 'SpreadElement', source: rawOf(a) }, ...span(a) });
      continue;
    }
    attributes.push({ name: jsxNameToString(a.name as AnyNode), value: normalizeAttrValue(a.value as AnyNode | null), ...span(a) });
  }
  return {
    type: 'element',
    tag,
    isComponent: /^[A-Z]/.test(tag),
    attributes,
    children: normalizeChildren((node.children as AnyNode[]) ?? []),
    selfClosing: !!opening.selfClosing,
    ...span(node),
  };
}

function normalizeExpressionChild(node: AnyNode): JsxExpression | null {
  const expr = node.expression as AnyNode;
  if (expr.type === 'JSXEmptyExpression') return null; // `{}` or a `{/* comment */}`
  return { type: 'expression', value: exprToStatic(expr), source: rawOf(expr), ...span(node) };
}

function normalizeAttrValue(value: AnyNode | null): StaticValue {
  if (value === null) return { static: true, json: true }; // valueless attr → boolean true
  if (value.type === 'Literal') return { static: true, json: value.value as JsonValue };
  if (value.type === 'JSXExpressionContainer') return exprToStatic(value.expression as AnyNode);
  return { static: false, exprType: value.type, source: rawOf(value) };
}

function exprToStatic(expr: AnyNode): StaticValue {
  const r = tryJson(expr);
  return r.ok ? { static: true, json: r.value } : { static: false, exprType: expr.type, source: rawOf(expr) };
}

function tryJson(expr: AnyNode): { ok: true; value: JsonValue } | { ok: false } {
  switch (expr.type) {
    case 'Literal': {
      const v = expr.value;
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return { ok: true, value: v };
      return { ok: false }; // regex / bigint
    }
    case 'UnaryExpression': {
      const arg = expr.argument as AnyNode;
      if ((expr.operator === '-' || expr.operator === '+') && arg.type === 'Literal' && typeof arg.value === 'number') {
        return { ok: true, value: expr.operator === '-' ? -(arg.value as number) : (arg.value as number) };
      }
      return { ok: false };
    }
    case 'ArrayExpression': {
      const arr: JsonValue[] = [];
      for (const el of (expr.elements as (AnyNode | null)[])) {
        if (el === null || el.type === 'SpreadElement') return { ok: false };
        const r = tryJson(el); if (!r.ok) return { ok: false }; arr.push(r.value);
      }
      return { ok: true, value: arr };
    }
    case 'ObjectExpression': {
      const obj: { [k: string]: JsonValue } = {};
      for (const p of (expr.properties as AnyNode[])) {
        if (p.type !== 'Property' || p.computed || p.kind !== 'init') return { ok: false };
        const key = p.key as AnyNode;
        let k: string;
        if (key.type === 'Identifier') k = key.name as string;
        else if (key.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number')) k = String(key.value);
        else return { ok: false };
        const r = tryJson(p.value as AnyNode); if (!r.ok) return { ok: false }; obj[k] = r.value;
      }
      return { ok: true, value: obj };
    }
    case 'TemplateLiteral': {
      const quasis = expr.quasis as AnyNode[];
      const exprs = expr.expressions as AnyNode[];
      if (exprs.length === 0 && quasis.length === 1) {
        return { ok: true, value: (quasis[0].value as { cooked: string }).cooked };
      }
      return { ok: false };
    }
    default:
      return { ok: false };
  }
}

function jsxNameToString(name: AnyNode): string {
  switch (name.type) {
    case 'JSXIdentifier': return name.name as string;
    case 'JSXNamespacedName': return `${jsxNameToString(name.namespace as AnyNode)}:${jsxNameToString(name.name as AnyNode)}`;
    case 'JSXMemberExpression': return `${jsxNameToString(name.object as AnyNode)}.${jsxNameToString(name.property as AnyNode)}`;
    default: return 'unknown';
  }
}
