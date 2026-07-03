/**
 * Tolerant HTML-ism cleanup for agent-authored markup.
 *
 * Agents author story bodies as HTML, and the common HTML-isms — comments, unclosed void tags,
 * a stray `<` in prose — are not valid JSX, so one of them anywhere in a large document fails the
 * whole-document parse (and with it an otherwise-correct EditFile/CreateFile). This sanitizer
 * rewrites exactly those three patterns into their JSX-safe equivalents.
 *
 * Template-literal spans are never touched: SQL in `query={`…`}` and CSS in `<style>{`…`}`
 * legitimately contain `<`, `--`, and anything else.
 *
 * It is applied only as a RETRY after a strict parse failure (see jsxToContent) — a document that
 * already parses is never altered.
 */

const VOID_TAGS = 'area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr';
const VOID_RE = new RegExp(`<(${VOID_TAGS})(\\s[^<>]*?)?\\s*>`, 'g');

function sanitizeSegment(seg: string): string {
  let s = seg.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(VOID_RE, (match, tag: string, attrs?: string) => {
    if (attrs && attrs.trimEnd().endsWith('/')) return match; // already self-closed
    return `<${tag}${attrs ?? ''}/>`;
  });
  // A `<` that can't start a tag, closing tag, fragment, or comment is prose — escape it.
  s = s.replace(/<(?![a-zA-Z/!>])/g, '&lt;');
  return s;
}

/** Rewrite HTML-isms (comments, void tags, stray `<`) to JSX-safe forms, skipping template literals. */
export function sanitizeLooseJsx(source: string): string {
  const parts: string[] = [];
  const tpl = /`(?:\\[\s\S]|[^`\\])*`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tpl.exec(source))) {
    parts.push(sanitizeSegment(source.slice(last, m.index)), m[0]);
    last = m.index + m[0].length;
  }
  parts.push(sanitizeSegment(source.slice(last)));
  return parts.join('');
}
