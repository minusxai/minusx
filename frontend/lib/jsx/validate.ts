/**
 * Static-subset + security validator for a parsed `jsx` AST. Returns a list of
 * {@link ValidationError} (empty = valid). This is the boundary that makes `jsx`
 * inert DATA: only JSON-literal attributes, only registered components / allowed
 * HTML tags, no event handlers, no dangerous URL schemes. A JSX parser does NOT
 * give the "static" guarantee for free — this pass enforces it.
 */
import { immutableSet } from '@/lib/utils/immutable-collections';
import type { JsxNode, JsxElement, ValidationError, ValidateOptions } from './types';

// Lowercase HTML tags that can introduce active content / navigation hijacking.
const DANGEROUS_TAGS = immutableSet([
  'script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form',
  'frame', 'frameset', 'applet', 'noscript',
]);

// Attributes whose value is a URL — checked against dangerous schemes. `srcset` and `ping`
// carry URL LISTS (comma/space separated) and are checked per entry.
const URL_ATTRS = immutableSet(['href', 'src', 'action', 'formaction', 'poster', 'background', 'cite', 'data', 'xlink:href', 'ping']);
const URL_LIST_ATTRS = immutableSet(['srcset', 'ping']);

// Attributes rejected by NAME on every tag: HTML injection (dangerouslySetInnerHTML, srcdoc),
// React internals (ref/key — never serializable data), and customized built-ins (is).
const DENIED_ATTRS = immutableSet(['dangerouslysetinnerhtml', 'ref', 'key', 'srcdoc', 'is']);

// `data:image/...` is allowed (inline images); other `data:` (e.g. text/html) is not.
const DANGEROUS_URL = /^(javascript|vbscript|data):/i;
const SAFE_DATA_URL = /^data:image\//i;

/**
 * True when a URL value carries a dangerous scheme. Browsers strip ASCII control chars and
 * spaces INSIDE the scheme before resolving (`java\tscript:` runs as `javascript:`), so the
 * check normalizes the same way instead of trusting the raw string.
 */
export function hasDangerousScheme(url: string): boolean {
  // eslint-disable-next-line no-control-regex -- deliberately mirrors browser scheme normalization
  const normalized = url.replace(/[\x00-\x20]/g, '');
  return DANGEROUS_URL.test(normalized) && !SAFE_DATA_URL.test(normalized);
}

/** Scheme-check every URL in a srcset/ping-style list ("url descriptor, url descriptor"). */
export function listHasDangerousScheme(value: string): boolean {
  return value.split(',').some(entry => {
    const url = entry.trim().split(/\s+/)[0];
    return !!url && hasDangerousScheme(url);
  });
}

export function validateJsx(nodes: JsxNode[], options: ValidateOptions): ValidationError[] {
  const components = new Set(options.components);
  const allowedHtml = options.allowedHtmlTags ? new Set(options.allowedHtmlTags) : null;
  const errors: ValidationError[] = [];
  for (const node of nodes) walk(node, components, allowedHtml, errors);
  return errors;
}

function walk(node: JsxNode, components: Set<string>, allowedHtml: Set<string> | null, errors: ValidationError[]): void {
  if (node.type === 'expression') {
    if (!node.value.static) {
      errors.push({ message: `Expression child must be a JSON literal, got ${node.value.exprType}`, start: node.start, end: node.end });
    }
    return;
  }
  if (node.type === 'text') return;
  validateElement(node, components, allowedHtml, errors);
  for (const child of node.children) walk(child, components, allowedHtml, errors);
}

function validateElement(el: JsxElement, components: Set<string>, allowedHtml: Set<string> | null, errors: ValidationError[]): void {
  // Tag allowlist.
  if (el.isComponent) {
    if (!components.has(el.tag)) {
      errors.push({ message: `Unknown component <${el.tag}> — not in the component registry`, tag: el.tag, start: el.start, end: el.end });
    }
  } else if (DANGEROUS_TAGS.has(el.tag.toLowerCase())) {
    errors.push({ message: `Disallowed tag <${el.tag}>`, tag: el.tag, start: el.start, end: el.end });
  } else if (allowedHtml && !allowedHtml.has(el.tag.toLowerCase())) {
    errors.push({ message: `Tag <${el.tag}> is not in the allowed HTML tag list`, tag: el.tag, start: el.start, end: el.end });
  }

  for (const a of el.attributes) {
    // Spread / non-static attribute values.
    if (!a.value.static) {
      errors.push({
        message: `Attribute "${a.name}" must be a JSON literal, got ${a.value.exprType}`,
        attr: a.name, tag: el.tag, start: a.start, end: a.end,
      });
      continue;
    }
    // Event handlers (on*) are executable — never allowed.
    if (/^on/i.test(a.name)) {
      errors.push({ message: `Event handler attribute "${a.name}" is not allowed`, attr: a.name, tag: el.tag, start: a.start, end: a.end });
      continue;
    }
    // Name-denied attributes (HTML injection / React internals / customized built-ins).
    if (DENIED_ATTRS.has(a.name.toLowerCase())) {
      errors.push({ message: `Attribute "${a.name}" is not allowed`, attr: a.name, tag: el.tag, start: a.start, end: a.end });
      continue;
    }
    // Dangerous URL schemes in URL-bearing attributes (list-valued ones checked per entry).
    if (typeof a.value.json === 'string') {
      const lower = a.name.toLowerCase();
      const dangerous = URL_LIST_ATTRS.has(lower)
        ? listHasDangerousScheme(a.value.json)
        : URL_ATTRS.has(lower) && hasDangerousScheme(a.value.json);
      if (dangerous) {
        errors.push({ message: `Attribute "${a.name}" has a disallowed URL scheme`, attr: a.name, tag: el.tag, start: a.start, end: a.end });
      }
    }
  }
}
