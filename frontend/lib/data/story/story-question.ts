/**
 * Inline `<Question>` embeds (File Architecture v2).
 *
 * A story's `<Question>` is polymorphic: `<Question id={42}/>` embeds a SAVED question file;
 * `<Question query={`…`} connection=… viz={…} params={…}/>` embeds an INLINE, story-local
 * question whose full definition lives in the story body — no saved file, no `assets` entry.
 *
 * Like `<Param>`, an inline question round-trips through `content.story` as a `<div
 * data-question-inline="…">` PLACEHOLDER carrying its JSON definition, so it renders where the
 * agent placed it (AgentHtml mounts a live chart there). The body is the single source of truth.
 *
 * Pure (client + server safe).
 */
import type { QuestionParameter, VizSettings, QuestionContent } from '@/lib/validation/atlas-schemas';
import { escAttr, escTemplate, serializeJsonAttr, parseJsonAttr } from './html-attr';

/** An inline question embedded directly in a story body (no saved file). */
export interface InlineQuestionEmbed {
  query: string;
  /** connection name the query runs against ('' if none) — maps to QuestionContent.connection_name. */
  connection: string;
  /** partial viz settings; defaults (table) are filled when projected to a QuestionContent. */
  vizSettings?: Partial<VizSettings>;
  parameters?: QuestionParameter[];
  /** render height for the embed div (e.g. '200px'); presentational only. */
  height?: string;
}

/**
 * Normalize literal escape sequences in an inline query into real whitespace. A `<Question>` whose
 * `query` is authored as a QUOTED jsx attribute (`query="SELECT\n…"`) — rather than a `{`…`}`
 * template literal — leaves `\n`/`\r`/`\t` as literal backslash sequences, because JSX attribute
 * strings (unlike JS strings/template literals) don't process escapes. Those literal `\` then break
 * the SQL parser. SQL is whitespace-insensitive outside string literals, so converting these escapes
 * to real whitespace makes the query run regardless of how the agent wrote it. A template-literal
 * query already holds real newlines (cooked), so this is a no-op for it.
 */
export function normalizeInlineQuery(q: string): string {
  return q.replace(/\\r\\n|\\r|\\n/g, '\n').replace(/\\t/g, '\t');
}

/** Build an inline embed from a `<Question>` element's parsed jsx attributes. Null if no `query`. */
export function inlineQuestionFromJsxAttrs(attrs: Record<string, unknown>): InlineQuestionEmbed | null {
  const raw = typeof attrs.query === 'string' ? attrs.query : '';
  if (!raw) return null;
  const query = normalizeInlineQuery(raw);
  const e: InlineQuestionEmbed = { query, connection: typeof attrs.connection === 'string' ? attrs.connection : '' };
  if (attrs.viz && typeof attrs.viz === 'object' && !Array.isArray(attrs.viz)) e.vizSettings = attrs.viz as Partial<VizSettings>;
  if (Array.isArray(attrs.params)) e.parameters = attrs.params as QuestionParameter[];
  if (typeof attrs.height === 'string' || typeof attrs.height === 'number') e.height = String(attrs.height);
  return e;
}

/** Inline embed → the `<div data-question-inline>` placeholder stored inside `content.story` HTML. */
export function inlineQuestionToPlaceholder(e: InlineQuestionEmbed): string {
  const payload: Record<string, unknown> = { query: e.query, connection_name: e.connection };
  if (e.vizSettings) payload.vizSettings = e.vizSettings;
  if (e.parameters) payload.parameters = e.parameters;
  if (e.height) payload.height = e.height;
  const h = (e.height ? String(e.height) : '430px').replace(/["']/g, '');
  return `<div data-question-inline="${serializeJsonAttr(payload)}" style="width:100%;height:${h}"></div>`;
}

const INLINE_Q_DIV_RE = /<div\s+([^>]*?data-question-inline="[^"]*"[^>]*?)>\s*<\/div>/g;

function payloadToEmbed(payload: Record<string, unknown> | null | undefined): InlineQuestionEmbed | null {
  if (typeof payload?.query !== 'string') return null;
  const e: InlineQuestionEmbed = {
    // Defensive: also normalize on read, so any embed already stored with literal \n escapes
    // (authored before the fix) still parses + runs correctly.
    query: normalizeInlineQuery(payload.query),
    connection: typeof payload.connection_name === 'string' ? payload.connection_name : '',
  };
  if (payload.vizSettings) e.vizSettings = payload.vizSettings as Partial<VizSettings>;
  if (payload.parameters) e.parameters = payload.parameters as QuestionParameter[];
  if (typeof payload.height === 'string') e.height = payload.height;
  return e;
}

function inlineFromDivInner(inner: string): InlineQuestionEmbed | null {
  const m = inner.match(/data-question-inline="([^"]*)"/);
  return m ? payloadToEmbed(parseJsonAttr<Record<string, unknown>>(m[1])) : null;
}

/** Read an inline embed from a rendered placeholder element (AgentHtml has the DOM node — the
 *  browser has already entity-decoded the attribute, so its value is plain JSON). */
export function inlineQuestionFromEl(el: { getAttribute(name: string): string | null }): InlineQuestionEmbed | null {
  return payloadToEmbed(parseJsonAttr<Record<string, unknown>>(el.getAttribute('data-question-inline')));
}

const SAVED_Q_DIV_RE = /data-question-id="(\d+)"/g;

/** Extract the saved-question file ids a story body embeds (the `data-question-id` placeholders). */
export function extractSavedQuestionIds(html: string | null | undefined): number[] {
  const ids = new Set<number>();
  for (const m of (html ?? '').matchAll(SAVED_Q_DIV_RE)) ids.add(Number(m[1]));
  return [...ids];
}

/**
 * Remap the saved-question ids a story body references, for a file-ID-shift migration. Rewrites
 * `data-question-id` (saved embeds) and `data-param-source-id` (a `<Param id=N>` import). Inline
 * questions carry no file id (they reference a connection by name), so they need no remap.
 */
export function remapStoryQuestionIds(html: string, remap: (id: number) => number): string {
  return html
    .replace(/data-question-id="(\d+)"/g, (_m, id: string) => `data-question-id="${remap(Number(id))}"`)
    .replace(/data-param-source-id="(\d+)"/g, (_m, id: string) => `data-param-source-id="${remap(Number(id))}"`);
}

/** Extract all inline question embeds from a story's HTML (the `data-question-inline` placeholders). */
export function extractInlineQuestions(html: string | null | undefined): InlineQuestionEmbed[] {
  const out: InlineQuestionEmbed[] = [];
  for (const m of (html ?? '').matchAll(INLINE_Q_DIV_RE)) {
    const e = inlineFromDivInner(m[1]);
    if (e) out.push(e);
  }
  return out;
}

/** Inline embed → the `<Question/>` jsx the agent reads/edits (query as a raw template literal).
 *  String attrs are entity-escaped (escAttr): JSX attribute strings don't process `\"` escapes,
 *  so a raw quote in a value would end the attribute early and fail the whole-document parse. */
export function inlineQuestionToJsx(e: InlineQuestionEmbed): string {
  const a: string[] = [`query={\`${escTemplate(e.query)}\`}`, `connection="${escAttr(e.connection)}"`];
  if (e.vizSettings) a.push(`viz={${JSON.stringify(e.vizSettings)}}`);
  if (e.parameters) a.push(`params={${JSON.stringify(e.parameters)}}`);
  if (e.height) a.push(`height="${escAttr(e.height)}"`);
  return `<Question ${a.join(' ')} />`;
}

/** Rewrite a story HTML's inline-question placeholders back to `<Question/>` jsx (for buildStoryJsx). */
export function placeholdersToInlineQuestionJsx(html: string | null | undefined): string {
  return (html ?? '').replace(INLINE_Q_DIV_RE, (whole, inner) => {
    const e = inlineFromDivInner(inner);
    return e ? inlineQuestionToJsx(e) : whole;
  });
}

/**
 * Count the questions a story/dashboard embeds (for chat-UI chips, badges). Story counts from
 * the body (saved + inline embeds); dashboard counts from the assets manifest.
 */
export function embeddedQuestionCount(content: unknown, type?: string | null): number {
  const c = content as { story?: string | null; assets?: { type?: string }[] } | null | undefined;
  if (type === 'story') {
    return extractSavedQuestionIds(c?.story).length + extractInlineQuestions(c?.story).length;
  }
  return (c?.assets ?? []).filter((a) => a?.type === 'question').length;
}

/** Project an inline embed to a full QuestionContent the renderer/query stack consumes. */
export function inlineEmbedToQuestionContent(e: InlineQuestionEmbed): QuestionContent {
  return {
    description: null,
    query: e.query,
    connection_name: e.connection,
    vizSettings: { type: 'table', ...(e.vizSettings ?? {}) } as VizSettings,
    parameters: e.parameters ?? [],
    parameterValues: null,
    references: null,
  };
}
