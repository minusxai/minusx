/**
 * Inline `<Number>` — a single LIVE figure that sits IN the prose (a styled `<span>`), not a
 * chart card. It's the lightweight counterpart to `<Question viz=single_value>`: use it to drop a
 * live number into a sentence or a hand-styled stat. Polymorphic like `<Question>`: `id={N}` reads
 * a saved question's value, or `query={`…`}` runs an inline query. The agent styles it freely
 * (`style={{…}}`), and an optional column/prefix/suffix decorate the figure.
 *
 * Round-trips through `content.story` as a `<span data-number-inline="…">` placeholder (so it
 * renders inline where the agent placed it; AgentHtml mounts the live figure there). Pure
 * (client + server safe).
 */
import { escTemplate, styleAttr, serializeJsonAttr, parseJsonAttr } from './html-attr';
import { normalizeInlineQuery } from './story-question';

/** An inline number embedded directly in a story body. One of `id` / `query` is required. */
export interface InlineNumberEmbed {
  /** saved question id — read its query's value. */
  id?: number;
  /** inline query (returns one row); its `col` (or first column) is the figure. */
  query?: string;
  connection?: string;
  /** column to read from the result row (defaults to the first column). */
  col?: string;
  prefix?: string;
  suffix?: string;
  /** agent CSS applied to the rendered `<span>` (themeable, sits in text). */
  style?: Record<string, string | number>;
}

/** Build an inline-number embed from a `<Number>` element's parsed jsx attributes. */
export function numberFromJsxAttrs(attrs: Record<string, unknown>): InlineNumberEmbed | null {
  const e: InlineNumberEmbed = {};
  if (typeof attrs.id === 'number') e.id = attrs.id;
  // Cook \n / \t escapes — same as inline <Question> embeds. The agent sometimes writes the query
  // as a double-quoted attr (`query="…\n…"`) instead of a backtick template literal, which leaves a
  // LITERAL backslash in the SQL ('syntax error at or near "\"'). A correct template literal arrives
  // already cooked, so this is a no-op on it.
  if (typeof attrs.query === 'string' && attrs.query) e.query = normalizeInlineQuery(attrs.query);
  if (e.id == null && !e.query) return null; // need a source
  if (typeof attrs.connection === 'string') e.connection = attrs.connection;
  if (typeof attrs.col === 'string') e.col = attrs.col;
  if (typeof attrs.prefix === 'string') e.prefix = attrs.prefix;
  if (typeof attrs.suffix === 'string') e.suffix = attrs.suffix;
  const st = styleAttr(attrs.style);
  if (st) e.style = st;
  return e;
}

/** Inline-number embed → the `<span data-number-inline>` placeholder stored inside content.story. */
export function numberToPlaceholder(e: InlineNumberEmbed): string {
  // data-number-id is emitted for a saved embed so its dependency is discoverable without parsing.
  const idAttr = e.id != null ? ` data-number-id="${e.id}"` : '';
  return `<span data-number-inline="${serializeJsonAttr(e)}"${idAttr}></span>`;
}

const NUMBER_SPAN_RE = /<span\s+[^>]*?data-number-inline="([^"]*)"[^>]*?>\s*<\/span>/g;

const isNumberEmbed = (e: InlineNumberEmbed) => e.id != null || !!e.query;
const embedFromJson = (raw: string): InlineNumberEmbed | null => parseJsonAttr<InlineNumberEmbed>(raw, isNumberEmbed);

/** Extract all inline-number embeds from a story's HTML (the `data-number-inline` placeholders). */
export function extractInlineNumbers(html: string | null | undefined): InlineNumberEmbed[] {
  const out: InlineNumberEmbed[] = [];
  for (const m of (html ?? '').matchAll(NUMBER_SPAN_RE)) {
    const e = embedFromJson(m[1]);
    if (e) out.push(e);
  }
  return out;
}

/** Read a number embed from a rendered placeholder element (browser entity-decodes the attr). */
export function numberFromEl(el: { getAttribute(name: string): string | null }): InlineNumberEmbed | null {
  return parseJsonAttr<InlineNumberEmbed>(el.getAttribute('data-number-inline'), isNumberEmbed);
}

/** Saved-question ids a story body references via `<Number id={N}>` (for the dependency graph). */
export function extractNumberQuestionIds(html: string | null | undefined): number[] {
  const ids = new Set<number>();
  for (const m of (html ?? '').matchAll(/data-number-id="(\d+)"/g)) ids.add(Number(m[1]));
  return [...ids];
}

/** Inline-number embed → the `<Number/>` jsx the agent reads/edits. */
export function numberToJsx(e: InlineNumberEmbed): string {
  const a: string[] = [];
  if (e.id != null) a.push(`id={${e.id}}`);
  if (e.query) a.push(`query={\`${escTemplate(e.query)}\`}`);
  if (e.connection) a.push(`connection="${e.connection}"`);
  if (e.col) a.push(`col="${e.col}"`);
  if (e.prefix != null) a.push(`prefix="${e.prefix}"`);
  if (e.suffix != null) a.push(`suffix="${e.suffix}"`);
  if (e.style) a.push(`style={${JSON.stringify(e.style)}}`);
  return `<Number ${a.join(' ')} />`;
}

/** Rewrite a story HTML's number placeholders back to `<Number/>` jsx (for buildStoryJsx). */
export function placeholdersToNumberJsx(html: string | null | undefined): string {
  return (html ?? '').replace(NUMBER_SPAN_RE, (whole, json) => {
    const e = embedFromJson(json);
    return e ? numberToJsx(e) : whole;
  });
}
