/**
 * WYSIWYG AST write-back for format:'jsx' stories (Story_Design_V2 §2).
 *
 * The interpreter (lib/story-ui/interpreter) stamps every rendered element with its AST
 * path (`data-mx-ast`, dot-separated child indexes counting ALL JsxNodes). While editing,
 * a contenteditable text host's DOM is the user's working copy; on commit the edit comes
 * back here as `{ astPath, innerHtml }` and is written into the JSX SOURCE — never scraped
 * from the DOM wholesale:
 *
 *  1. parse the source (lib/jsx), locate the host element by its AST path;
 *  2. convert the edited innerHTML to JSX nodes with the HTML→JSX conversion below —
 *     entities decoded, tags lowercased, void tags self-closed — SANITIZING as it goes:
 *     anything `validateJsxSource` would reject (dangerous tags, `on*` handlers, denied
 *     attrs, dangerous URL schemes) is DROPPED, not saved — a paste is an injection path
 *     and gets no editor trust;
 *  3. nested elements still carrying `data-mx-ast` that map to a COMPONENT in the original
 *     AST (embeds — their DOM is render chrome, not source) are spliced back verbatim from
 *     the ORIGINAL tree; plain HTML carriers just lose the stamp (the edited DOM copy wins);
 *  4. replace the host's children and re-serialize the whole tree (serializeJsx).
 *
 * Pure module — no DOM APIs — so the write-back is unit-testable in the node project.
 */
import {
  parseJsx, serializeJsx,
  type JsxNode, type JsxElement, type JsxAttribute, type ValidationError,
} from '@/lib/jsx';
import { validateJsx, hasDangerousScheme, listHasDangerousScheme } from '@/lib/jsx/validate';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { immutableSet } from '@/lib/utils/immutable-collections';

export interface JsxDomEdit {
  /** The edited host's `data-mx-ast` path (dot-separated indexes into the node tree). */
  astPath: string;
  /** The host's edited innerHTML (contenteditable output — rich inline HTML, possibly hostile). */
  innerHtml: string;
}

export interface ApplyDomEditsResult {
  /** The updated JSX source (unchanged when nothing could be applied). */
  source: string;
  /** Failures + sanitizer drops. Edits still apply; offending nodes/attrs are simply gone. */
  errors: ValidationError[];
}

export const AST_PATH_DOM_ATTR = 'data-mx-ast';

// ---------------------------------------------------------------------------
// Text-host predicate (which elements the editor may make contenteditable)
// ---------------------------------------------------------------------------

/**
 * A text host is an HTML element whose direct children include at least one non-whitespace
 * text node and whose subtree contains NO component/embed — those stay locked (their chrome
 * is render output; an edit could not be written back). `<style>` is text-shaped but is CSS,
 * not prose — never editable.
 */
export function isEditableTextHost(node: JsxElement): boolean {
  if (node.isComponent || node.tag.toLowerCase() === 'style') return false;
  const hasText = node.children.some(c => c.type === 'text' && c.value.trim().length > 0);
  return hasText && !hasComponentDescendant(node);
}

function hasComponentDescendant(node: JsxElement): boolean {
  return node.children.some(c =>
    c.type === 'element' && (c.isComponent || hasComponentDescendant(c)));
}

// ---------------------------------------------------------------------------
// AST path resolution (mirrors the interpreter's indexing: ALL JsxNodes count)
// ---------------------------------------------------------------------------

function resolveByPath(roots: JsxNode[], path: string): JsxNode | null {
  const parts = path.split('.').map(Number);
  if (parts.length === 0 || parts.some(n => !Number.isInteger(n) || n < 0)) return null;
  let list = roots;
  let node: JsxNode | null = null;
  for (const idx of parts) {
    node = list[idx] ?? null;
    if (!node) return null;
    list = node.type === 'element' ? node.children : [];
  }
  return node;
}

// ---------------------------------------------------------------------------
// HTML → JSX conversion (DOM-ish parser; pure, no document)
// ---------------------------------------------------------------------------

type TmpElement = { kind: 'el'; tag: string; attrs: { name: string; value: string | true }[]; children: TmpNode[] };
type TmpNode = TmpElement | { kind: 'text'; value: string };

const VOID_TAGS = immutableSet([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
/** Content parses as raw text (no nested tags) per the HTML spec's raw-text elements. */
const RAW_TEXT_TAGS = immutableSet(['script', 'style', 'textarea', 'title', 'xmp']);
/** Active-content tags: dropped WITH their entire subtree (mirrors lib/jsx/validate's denylist). */
const DROP_TAGS = immutableSet([
  'script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form',
  'frame', 'frameset', 'applet', 'noscript',
]);
/** Name-denied attrs (lowercase) — lib/jsx/validate DENIED_ATTRS. */
const DENIED_ATTRS = immutableSet(['dangerouslysetinnerhtml', 'ref', 'key', 'srcdoc', 'is']);
const URL_ATTRS = immutableSet(['href', 'src', 'action', 'formaction', 'poster', 'background', 'cite', 'data', 'xlink:href', 'ping']);
const URL_LIST_ATTRS = immutableSet(['srcset', 'ping']);
const ALLOWED_HTML = immutableSet<string>(STORY_HTML_TAGS);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Lenient HTML fragment parser: contenteditable output is mostly well-formed; garbage degrades to text. */
function parseHtmlFragment(html: string): TmpNode[] {
  const root: TmpElement = { kind: 'el', tag: '#root', attrs: [], children: [] };
  const stack: TmpElement[] = [root];
  const top = () => stack[stack.length - 1];
  const pushText = (raw: string) => { if (raw) top().children.push({ kind: 'text', value: decodeEntities(raw) }); };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { pushText(html.slice(i)); break; }
    if (lt > i) pushText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { // doctype / processing instruction
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html[lt + 1] === '/') { // closing tag: pop to the matching open element (or ignore)
      const end = html.indexOf('>', lt);
      const tag = html.slice(lt + 2, end === -1 ? html.length : end).trim().toLowerCase();
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tag === tag) { stack.length = s; break; }
      }
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt));
    if (!m) { pushText('<'); i = lt + 1; continue; } // stray '<' — literal text
    const tag = m[1].toLowerCase();
    let j = lt + m[0].length;
    const attrs: { name: string; value: string | true }[] = [];
    let selfClose = false;
    while (j < html.length) { // attributes until '>' / '/>'
      while (j < html.length && /\s/.test(html[j])) j++;
      if (html[j] === '>') { j++; break; }
      if (html[j] === '/') {
        if (html[j + 1] === '>') { selfClose = true; j += 2; break; }
        j++;
        continue;
      }
      const am = /^[^\s=/>]+/.exec(html.slice(j));
      if (!am) { j++; continue; }
      const name = am[0];
      j += am[0].length;
      while (j < html.length && /\s/.test(html[j])) j++;
      if (html[j] === '=') {
        j++;
        while (j < html.length && /\s/.test(html[j])) j++;
        let value = '';
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          value = html.slice(j + 1, end === -1 ? html.length : end);
          j = end === -1 ? html.length : end + 1;
        } else {
          const vm = /^[^\s>]*/.exec(html.slice(j));
          value = vm ? vm[0] : '';
          j += value.length;
        }
        attrs.push({ name, value: decodeEntities(value) });
      } else {
        attrs.push({ name, value: true });
      }
    }
    const el: TmpElement = { kind: 'el', tag, attrs, children: [] };
    top().children.push(el);
    if (RAW_TEXT_TAGS.has(tag)) { // consume raw content up to the matching close tag
      const rest = html.slice(j);
      const cm = new RegExp(`</${tag}\\s*>`, 'i').exec(rest);
      const raw = cm ? rest.slice(0, cm.index) : rest;
      if (raw) el.children.push({ kind: 'text', value: raw });
      i = cm ? j + cm.index + cm[0].length : html.length;
      continue;
    }
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(el);
    i = j;
  }
  return root.children;
}

// ---------------------------------------------------------------------------
// Sanitize + convert Tmp tree → JsxNodes (with original-AST splicing)
// ---------------------------------------------------------------------------

function sanitizeAttrs(el: TmpElement, errors: ValidationError[]): JsxAttribute[] {
  const out: JsxAttribute[] = [];
  for (const a of el.attrs) {
    const lower = a.name.toLowerCase();
    // Render/edit artifacts (data-mx-ast, data-mx-busy, contenteditable) never belong in source.
    if (lower.startsWith('data-mx-') || lower === 'contenteditable') continue;
    if (lower.startsWith('on') || DENIED_ATTRS.has(lower)) {
      errors.push({ message: `Dropped attribute "${a.name}" on pasted <${el.tag}>`, attr: a.name, tag: el.tag });
      continue;
    }
    if (typeof a.value === 'string') {
      const dangerous = URL_LIST_ATTRS.has(lower)
        ? listHasDangerousScheme(a.value)
        : URL_ATTRS.has(lower) && hasDangerousScheme(a.value);
      if (dangerous) {
        errors.push({ message: `Dropped attribute "${a.name}" with a disallowed URL scheme on <${el.tag}>`, attr: a.name, tag: el.tag });
        continue;
      }
    }
    out.push({ name: a.name, value: { static: true, json: a.value }, start: 0, end: 0 });
  }
  return out;
}

function tmpToJsxNodes(tmp: TmpNode[], originalRoots: JsxNode[], errors: ValidationError[]): JsxNode[] {
  const out: JsxNode[] = [];
  for (const n of tmp) {
    if (n.kind === 'text') {
      out.push({ type: 'text', value: n.value, start: 0, end: 0 });
      continue;
    }
    // Elements still stamped with their AST path: a COMPONENT's DOM is render chrome — splice
    // the ORIGINAL AST child back verbatim. Plain HTML carriers just lose the stamp below.
    const astAttr = n.attrs.find(a => a.name.toLowerCase() === AST_PATH_DOM_ATTR);
    if (astAttr && typeof astAttr.value === 'string') {
      const original = resolveByPath(originalRoots, astAttr.value);
      if (original && original.type === 'element' && original.isComponent) {
        out.push(structuredClone(original));
        continue;
      }
    }
    if (DROP_TAGS.has(n.tag)) { // active content: dropped with its entire subtree
      errors.push({ message: `Dropped pasted <${n.tag}> element`, tag: n.tag });
      continue;
    }
    const children = tmpToJsxNodes(n.children, originalRoots, errors);
    if (!ALLOWED_HTML.has(n.tag)) { // not story markup, not dangerous: unwrap, keep the content
      errors.push({ message: `Unwrapped pasted <${n.tag}> element (not in the story tag allowlist)`, tag: n.tag });
      out.push(...children);
      continue;
    }
    out.push({
      type: 'element',
      tag: n.tag,
      isComponent: false,
      attributes: sanitizeAttrs(n, errors),
      children,
      selfClosing: children.length === 0,
      start: 0,
      end: 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The write-back
// ---------------------------------------------------------------------------

/**
 * Apply contenteditable DOM edits back onto a story's JSX source. Each edit REPLACES the
 * children of the element at `astPath` with the sanitized JSX conversion of `innerHtml`.
 * Never throws; unresolvable paths / residual validation failures skip that edit and are
 * reported in `errors` (sanitizer drops are reported too, but do not block the edit).
 */
export function applyDomEditsToJsx(source: string, edits: JsxDomEdit[]): ApplyDomEditsResult {
  const parsed = parseJsx(source);
  if (!parsed.ok) return { source, errors: [{ message: `JSX syntax error: ${parsed.error}` }] };
  const errors: ValidationError[] = [];

  // Resolve every host against the ORIGINAL tree before mutating anything — edits replace
  // children in place (indexes at and above host level never shift), so paths stay valid.
  const resolved = edits.map(edit => ({ edit, host: resolveByPath(parsed.nodes, edit.astPath) }));
  let applied = false;
  for (const { edit, host } of resolved) {
    if (!host || host.type !== 'element') {
      errors.push({ message: `No element at AST path "${edit.astPath}" — edit skipped` });
      continue;
    }
    const children = tmpToJsxNodes(parseHtmlFragment(edit.innerHtml), parsed.nodes, errors);
    // Belt-and-braces: the sanitizer must have produced validator-clean nodes. If anything
    // slipped through (a future validator rule this module lags behind), refuse the edit.
    const residual = validateJsx(children, { components: JSX_STORY_COMPONENT_NAMES, allowedHtmlTags: STORY_HTML_TAGS });
    if (residual.length > 0) {
      errors.push(...residual);
      continue;
    }
    host.children = children;
    if (children.length > 0) host.selfClosing = false;
    applied = true;
  }
  return { source: applied ? serializeJsx(parsed.nodes) : source, errors };
}
