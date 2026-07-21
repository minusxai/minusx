/**
 * Banned story CSS — the ONE constant module behind every enforcement point (Story_Design_V2 §4).
 *
 * Two bans, three enforcement points (prompt line; sanitizer strip on `<style>`/inline styles at
 * story save; Tailwind candidate filter before compile):
 *  1. `position: fixed` / `position: sticky` — containing-block semantics break inside the
 *     `<svg><foreignObject>` render surface, so a fixed element lands somewhere else in captures.
 *  2. EVERY external-fetch construct — `url()` / `src()` function tokens and `@import` at-rules
 *     (string and functional form); only `data:` URIs pass. Dual purpose: exfiltration guard
 *     (authored CSS firing fetches from guest viewers) and capture-taint guard (the serialized
 *     SVG must be self-contained).
 *
 * Scope: format:'jsx' stories' AUTHORED CSS. Legacy stories are frozen and keep their `@import`
 * fonts live — the sanitizer is wired only into the jsx-story save path (file-markup.ts).
 *
 * Enforcement is declaration-level: a banned declaration is stripped, its siblings survive — a
 * save never fails on style content. Detection runs on a DECODED copy (comments removed, CSS
 * escapes and HTML entities resolved, lowercased) so `\75 rl(...)`, `POSITION:FIXED`, or
 * `url(&quot;…&quot;)` can't smuggle past it; the strip itself removes the ORIGINAL text.
 */

/** Position values banned inside stories (checked as `position: <value>`). */
export const BANNED_POSITION_VALUES = ['fixed', 'sticky'] as const;

/** Tailwind utilities that compile to a banned position (variant/important forms handled). */
export const BANNED_POSITION_UTILITIES = ['fixed', 'sticky'] as const;

/** Decode basic HTML entities (markup-carried CSS is entity-escaped). */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Normalize a CSS fragment for DETECTION only: comments out, escapes/entities decoded, lowercased. */
function decodeForDetection(s: string): string {
  let out = decodeEntities(s.replace(/\/\*[\s\S]*?\*\//g, ''));
  out = out.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => {
    try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; }
  });
  out = out.replace(/\\(.)/g, '$1');
  return out.toLowerCase();
}

const POSITION_RE = /position\s*:\s*(fixed|sticky)\b/;
// A url(/src( token preceded by a non-ident char (or start) so `background-url-like` custom names
// don't false-positive; captures the (possibly quoted) target for the data:-only check.
const URL_TARGET_RE = /(?:^|[^a-z0-9_-])(?:url|src)\(\s*["']?\s*([^"'\s)]*)/g;
const IMPORT_RE = /(?:^|[^a-z0-9_-])@import\b/;

/** True when a decoded CSS fragment contains a url()/src() token whose target is not a data: URI. */
function hasExternalUrlTarget(decoded: string): boolean {
  for (const m of decoded.matchAll(URL_TARGET_RE)) {
    if (!m[1].startsWith('data:')) return true;
  }
  return false;
}

const ENTITY_RE = /&(?:[a-zA-Z]+|#x?[0-9a-fA-F]+);/g;

/**
 * Mask HTML entities so their trailing `;` doesn't read as a declaration terminator
 * (`&quot;` ends in `;` — splitting there would shred the declaration). Restore per segment.
 */
function maskEntities(s: string): { masked: string; restore: (seg: string) => string } {
  const entities: string[] = [];
  const masked = s.replace(ENTITY_RE, (e) => {
    entities.push(e);
    return `${entities.length - 1}`;
  });
  return {
    masked,
    restore: (seg) => seg.replace(/(\d+)/g, (_, i) => entities[Number(i)] ?? ''),
  };
}

/** True when a single declaration (or at-statement) must be stripped. `raw` is the ORIGINAL text. */
function isBannedSegment(raw: string): boolean {
  const d = decodeForDetection(raw);
  if (IMPORT_RE.test(d)) {
    // @import passes only when every referenced target is a data: URI.
    const targets = [...d.matchAll(/url\(\s*["']?\s*([^"')\s]+)|@import\s+["']([^"']+)/g)]
      .map((m) => m[1] ?? m[2])
      .filter((t): t is string => !!t);
    return targets.length === 0 || targets.some((t) => !t.startsWith('data:'));
  }
  if (POSITION_RE.test(d)) return true;
  return hasExternalUrlTarget(d);
}

/**
 * Strip banned declarations from a full stylesheet, preserving everything else byte-for-byte.
 * Walks the sheet splitting at `;` `{` `}`: segments terminated by `{` are selectors/at-preludes
 * (kept — the ban never removes structure), segments terminated by `;`/`}`/EOF are declarations
 * or at-statements (dropped when banned).
 */
export function sanitizeCssText(css: string): string {
  const { masked, restore } = maskEntities(css);
  let out = '';
  let start = 0;
  let quote: string | null = null;
  let parens = 0;
  for (let i = 0; i <= masked.length; i++) {
    const ch = i < masked.length ? masked[i] : ';'; // EOF closes the last segment
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') { parens++; continue; }
    if (ch === ')') { parens = Math.max(0, parens - 1); continue; }
    if (parens > 0) continue; // `;` inside url(data:image/png;base64,…) is not a terminator
    if (ch !== ';' && ch !== '{' && ch !== '}') continue;
    const seg = restore(masked.slice(start, i));
    const isDeclaration = ch !== '{';
    if (isDeclaration && isBannedSegment(seg)) {
      // Drop the declaration; keep a closing brace, swallow a `;` terminator.
      if (ch === '}') out += '}';
    } else {
      out += seg;
      if (i < masked.length) out += ch;
    }
    start = i + 1;
  }
  return out;
}

/** Strip banned declarations from an inline `style` attribute value (entity-escaped or raw). */
export function sanitizeInlineStyle(style: string): string {
  const { masked, restore } = maskEntities(style);
  const decls: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let parens = 0;
  for (let i = 0; i <= masked.length; i++) {
    const ch = i < masked.length ? masked[i] : ';';
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') { parens++; continue; }
    if (ch === ')') { parens = Math.max(0, parens - 1); continue; }
    if (ch !== ';' || parens > 0) continue;
    decls.push(restore(masked.slice(start, i)));
    start = i + 1;
  }
  return decls.filter((d) => d.trim() !== '' && !isBannedSegment(d)).join(';');
}

const STYLE_BLOCK_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const STYLE_ATTR_RE = /(\bstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi;

/**
 * Sanitize every `<style>` block and inline `style` attribute in story markup. This is the save-path
 * enforcement point: it runs where markup becomes content (file-markup.ts), so banned CSS never
 * reaches `content.story`, whichever door the write came through.
 */
export function sanitizeStoryMarkupCss(markup: string): string {
  return markup
    .replace(STYLE_BLOCK_RE, (_, open: string, css: string, close: string) =>
      `${open}${sanitizeCssText(css)}${close}`)
    .replace(STYLE_ATTR_RE, (_, prefix: string, _quoted: string, dq: string | undefined, sq: string | undefined) => {
      const value = dq ?? sq ?? '';
      const quote = dq !== undefined ? '"' : "'";
      return `${prefix}${quote}${sanitizeInlineStyle(value)}${quote}`;
    });
}

/**
 * Tailwind candidate filter — drops candidates that would compile to banned CSS, BEFORE compile.
 * A separate, explicit step from buildSalvaging's error-bisect: a guard reject must never be
 * absorbed (and silenced) as a "bad token" the bisect happened to drop.
 */
export function isBannedCandidate(candidate: string): boolean {
  // Base utility = the part after the last variant `:` OUTSIDE brackets; strip `!` markers.
  let depth = 0;
  let baseStart = 0;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ':' && depth === 0) baseStart = i + 1;
  }
  const base = candidate.slice(baseStart).replace(/^!|!$/g, '');
  if ((BANNED_POSITION_UTILITIES as readonly string[]).includes(base)) return true;
  // Arbitrary values: external url()/src() or a smuggled @import. Underscores are Tailwind's
  // encoding for spaces inside arbitrary values — normalize before detection.
  const d = decodeForDetection(candidate.replace(/_/g, ' '));
  return hasExternalUrlTarget(d) || d.includes('@import');
}

/** Split candidates into { kept, banned }, preserving order. */
export function partitionBannedCandidates(candidates: string[]): { kept: string[]; banned: string[] } {
  const kept: string[] = [];
  const banned: string[] = [];
  for (const c of candidates) (isBannedCandidate(c) ? banned : kept).push(c);
  return { kept, banned };
}
