/**
 * Render a (validated) `jsx` AST to React nodes via a component registry.
 *
 * Capitalized tags resolve to registered components (JSON attributes become props);
 * lowercase tags become plain HTML elements with a small attribute mapping
 * (`class`→`className`, `for`→`htmlFor`, `style` string→object). We build React
 * elements directly — there is no `eval` and no `dangerouslySetInnerHTML`, so an
 * un-validated/unknown component renders to `null` rather than executing anything.
 *
 * Render assumes the AST passed {@link validateJsx}; it is defensive but not a
 * substitute for validation.
 */
import { createElement, type ComponentType, type ReactNode } from 'react';
import type { JsxNode, JsxElement, JsonValue } from './types';

export type JsxComponentRegistry = Record<string, ComponentType<Record<string, unknown>>>;

const HTML_ATTR_MAP: Record<string, string> = { class: 'className', for: 'htmlFor' };

export function renderJsx(nodes: JsxNode[], registry: JsxComponentRegistry): ReactNode[] {
  return nodes.map((n, i) => renderNode(n, registry, i));
}

function renderNode(node: JsxNode, registry: JsxComponentRegistry, key: number): ReactNode {
  if (node.type === 'text') return node.value;
  if (node.type === 'expression') {
    if (!node.value.static) return null;
    const v = node.value.json;
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : (v as ReactNode);
  }
  const children = node.children.map((c, i) => renderNode(c, registry, i));
  if (node.isComponent) {
    const Comp = registry[node.tag];
    if (!Comp) return null; // unknown component — validate should have rejected it
    return createElement(Comp, { key, ...componentProps(node) }, ...children);
  }
  return createElement(node.tag, { key, ...htmlProps(node) }, ...children);
}

/** Component props: JSON attribute values passed through verbatim. */
function componentProps(el: JsxElement): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const a of el.attributes) {
    if (a.value.static) props[a.name] = a.value.json;
  }
  return props;
}

/** HTML props: map class/for, parse style string→object, drop on* handlers. */
function htmlProps(el: JsxElement): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const a of el.attributes) {
    if (!a.value.static || /^on/i.test(a.name)) continue;
    const name = HTML_ATTR_MAP[a.name] ?? a.name;
    if (name === 'style' && typeof a.value.json === 'string') {
      props.style = parseStyle(a.value.json);
    } else {
      props[name] = a.value.json as JsonValue;
    }
  }
  return props;
}

function parseStyle(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of raw.split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!prop) continue;
    const name = prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[name] = val;
  }
  return out;
}
