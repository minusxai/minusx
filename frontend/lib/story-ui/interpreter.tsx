/**
 * Story interpreter (Story_Design_V2 §2): validated static-JSX AST → React elements over an
 * injected component registry. No eval, ever — the AST is data, the registry is code we ship.
 *
 * Runs in the PARENT React tree; the caller portals the result into the story iframe's root
 * (the StoryEmbeds architecture, generalized). Defense in depth: `validateJsxSource` is the
 * authoring gate, but the interpreter independently drops dangerous props (handlers, HTML
 * injection, dangerous URL schemes), so an unvalidated AST still can't reach React unsafely.
 *
 * Every element is stamped with `data-mx-ast` (its path in the AST, e.g. "0.2.1") — the
 * WYSIWYG write-back uses it to map a DOM edit to the JSX source node it came from. The
 * stamped DOM is render output only; new-format stories persist JSX source, never DOM.
 */
import React from 'react';
import type { JsxNode } from '@/lib/jsx';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { hasDangerousScheme, listHasDangerousScheme } from '@/lib/jsx/validate';

export interface StoryInterpreterOptions {
  /** Component registry: shadcn components + embeds. Unknown component tags render nothing. */
  components: Record<string, React.ComponentType<Record<string, unknown>>>;
}

/** JSX attr names → React prop names for HTML tags (agents author HTML spellings). */
const HTML_ATTR_TO_REACT: Record<string, string> = { class: 'className', for: 'htmlFor' };

/** Controlled props mapped to their uncontrolled forms — authored markup has no handlers. */
const CONTROLLED_TO_DEFAULT: Record<string, string> = {
  value: 'defaultValue', open: 'defaultOpen', checked: 'defaultChecked',
};
/**
 * `value` is only a CONTROLLED prop on the stateful roots (Tabs/Accordion select a value).
 * Everywhere else it's identity or data — TabsTrigger/TabsContent/AccordionItem use `value`
 * to NAME a pane, Progress uses it as the displayed number — and rewriting those to
 * `defaultValue` breaks the component. Restrict the mapping to the roots.
 */
const VALUE_CONTROLLED_TAGS = immutableSet(['Tabs', 'Accordion']);

/** Name-denied props, lowercase (mirrors lib/jsx/validate.ts DENIED_ATTRS + React internals). */
const DENIED_PROPS = immutableSet(['dangerouslysetinnerhtml', 'ref', 'key', 'srcdoc', 'is']);

/** URL-bearing props, lowercase (scheme-filtered; list-valued ones checked per entry). */
const URL_PROPS = immutableSet(['href', 'src', 'action', 'formaction', 'poster', 'background', 'cite', 'data', 'xlinkhref', 'ping']);
const URL_LIST_PROPS = immutableSet(['srcset', 'ping']);

export const AST_PATH_ATTR = 'data-mx-ast';

export function renderStoryNodes(nodes: JsxNode[], options: StoryInterpreterOptions): React.ReactNode {
  return nodes.map((n, i) => renderNode(n, options, String(i)));
}

function renderNode(node: JsxNode, options: StoryInterpreterOptions, path: string): React.ReactNode {
  if (node.type === 'text') return node.value;
  if (node.type === 'expression') {
    if (!node.value.static) return null;
    const v = node.value.json;
    return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
  }

  const isComponent = node.isComponent;
  const Component = isComponent ? options.components[node.tag] : null;
  if (isComponent && !Component) return null; // validator rejects these; render stays safe regardless

  const props = buildProps(node.attributes, isComponent, node.tag, path);
  const children = node.children.map((c, i) => renderNode(c, options, `${path}.${i}`));
  const type = (Component ?? node.tag.toLowerCase()) as React.ElementType;
  // Void HTML elements must not receive children (React throws).
  const kids = children.length > 0 ? children : undefined;
  return React.createElement(type, { ...props, key: path }, ...(kids ?? []));
}

function buildProps(
  attributes: { name: string; value: { static: boolean; json?: unknown } }[],
  isComponent: boolean,
  tag: string,
  path: string,
): Record<string, unknown> {
  const props: Record<string, unknown> = { [AST_PATH_ATTR]: path };
  for (const a of attributes) {
    if (!a.value.static) continue; // non-static values never render (validator rejects them too)
    const lower = a.name.toLowerCase();
    if (lower.startsWith('on') || DENIED_PROPS.has(lower)) continue;

    let name = HTML_ATTR_TO_REACT[a.name] ?? a.name;
    let value = a.value.json;

    // Dangerous URL schemes dropped (browser-normalized check — see lib/jsx/validate.ts).
    if (typeof value === 'string') {
      const dangerous = URL_LIST_PROPS.has(lower)
        ? listHasDangerousScheme(value)
        : URL_PROPS.has(lower) && hasDangerousScheme(value);
      if (dangerous) continue;
    }

    // `style`: authored as a CSS string (HTML idiom) or an object — React needs an object.
    if (name === 'style') {
      const style = typeof value === 'string' ? cssStringToStyleObject(value) : sanitizeStyleObject(value);
      if (style) props.style = style;
      continue;
    }

    // Objects/arrays: meaningful as component props (viz/params envelopes); dropped on HTML
    // tags, where React would stringify them into attributes to no purpose.
    if (typeof value === 'object' && value !== null && !isComponent) continue;

    // Controlled → uncontrolled on components (no handlers exist to service controlled props).
    // `value` only on the stateful roots — see VALUE_CONTROLLED_TAGS.
    if (isComponent && CONTROLLED_TO_DEFAULT[name] && (name !== 'value' || VALUE_CONTROLLED_TAGS.has(tag))) {
      name = CONTROLLED_TO_DEFAULT[name];
    }

    props[name] = value;
  }
  return props;
}

/** "margin-top: 4px; color: red" → { marginTop: '4px', color: 'red' } (custom props kept as-is). */
function cssStringToStyleObject(css: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const rawProp = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!rawProp || !value) continue;
    const prop = rawProp.startsWith('--')
      ? rawProp
      : rawProp.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/^(webkit|moz|ms|o)([A-Z])/, (_, p: string, c: string) => p[0].toUpperCase() + p.slice(1) + c);
    out[prop] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Style objects: plain string/number values only — never nested structures or functions-as-data. */
function sanitizeStyleObject(value: unknown): Record<string, string | number> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}
