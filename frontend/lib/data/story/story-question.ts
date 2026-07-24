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
import type { QuestionParameter, VizSettings, QuestionContent, VizEnvelope, SpreadsheetSource } from '@/lib/validation/atlas-schemas';
import { vizSettingsToEnvelopeStatic } from '@/lib/viz/from-vizsettings';
import { isSpreadsheetSource } from '@/lib/spreadsheet/materialize';
import { escAttr, escTemplate, serializeJsonAttr, parseJsonAttr } from './html-attr';
import { updateJsxElementAtPath, setStaticJsxAttr } from './jsx-edit';
import type { JsonValue } from '@/lib/jsx';

/** An inline question embedded directly in a story body (no saved file). Its data comes from
 *  EITHER an inline SQL `query` (against `connection`) OR an inline `spreadsheet` (direct rows,
 *  no connection) — at least one must be present. */
export interface InlineQuestionEmbed {
  query?: string;
  /** connection name the query runs against ('' if none) — maps to QuestionContent.connection_name. */
  connection: string;
  /** Viz V2 envelope — the ONLY viz representation an embed carries. Legacy VizSettings inputs
   *  (old story bodies, old-style viz attrs) are auto-upgraded to an envelope at the parse
   *  boundary; omitted → renders as a default table. */
  viz?: VizEnvelope;
  /** direct tabular data (the spreadsheet editor's source) — rendered without executing any SQL. */
  spreadsheet?: SpreadsheetSource;
  parameters?: QuestionParameter[];
  /** render height for the embed div (e.g. '200px'); presentational only. */
  height?: string;
}

/** The projection default for a viz-less embed — identical to a new question file's default
 *  (template-defaults.ts). Never persisted into the story body (see questionContentToInlineEmbed). */
const DEFAULT_TABLE_ENVELOPE: VizEnvelope = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null },
};
const isDefaultTableEnvelope = (v: VizEnvelope): boolean =>
  JSON.stringify(v) === JSON.stringify(DEFAULT_TABLE_ENVELOPE);

/** Narrow a jsx/JSON `viz` attribute value to a Viz V2 envelope (vs a legacy Partial<VizSettings>). */
export function vizEnvelopeFromAttr(v: unknown): VizEnvelope | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)
    && (v as { version?: unknown }).version === 2 && !!(v as { source?: unknown }).source) {
    return v as VizEnvelope;
  }
  return undefined;
}

/** An inline embed's viz input → a V2 envelope. Envelopes pass through; a legacy-shaped
 *  VizSettings object (old story bodies / old agent habits) is AUTO-UPGRADED via the shipped
 *  V1→V2 converter, so the embed model only ever carries envelopes. */
function inlineVizFromValue(v: unknown, query?: string): VizEnvelope | undefined {
  const env = vizEnvelopeFromAttr(v);
  if (env) return env;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return vizSettingsToEnvelopeStatic({ type: 'table', ...(v as Partial<VizSettings>) } as VizSettings, query);
  }
  return undefined;
}

function spreadsheetFromAttr(v: unknown): SpreadsheetSource | undefined {
  return isSpreadsheetSource(v) ? v : undefined;
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

/** Build an inline embed from a `<Question>` element's parsed jsx attributes.
 *  Null when there is neither a `query` nor a `spreadsheet` (not an inline question). */
export function inlineQuestionFromJsxAttrs(attrs: Record<string, unknown>): InlineQuestionEmbed | null {
  const raw = typeof attrs.query === 'string' ? attrs.query : '';
  const spreadsheet = spreadsheetFromAttr(attrs.spreadsheet);
  if (!raw && !spreadsheet) return null;
  const e: InlineQuestionEmbed = { connection: typeof attrs.connection === 'string' ? attrs.connection : '' };
  if (raw) e.query = normalizeInlineQuery(raw);
  if (spreadsheet) e.spreadsheet = spreadsheet;
  const env = inlineVizFromValue(attrs.viz, e.query);
  if (env) e.viz = env;
  if (Array.isArray(attrs.params)) e.parameters = attrs.params as QuestionParameter[];
  if (typeof attrs.height === 'string' || typeof attrs.height === 'number') e.height = String(attrs.height);
  return e;
}

/** Inline embed → the `<div data-question-inline>` placeholder stored inside `content.story` HTML. */
export function inlineQuestionToPlaceholder(e: InlineQuestionEmbed): string {
  const payload: Record<string, unknown> = { connection_name: e.connection };
  if (e.query) payload.query = e.query;
  if (e.spreadsheet) payload.spreadsheet = e.spreadsheet;
  if (e.viz) payload.viz = e.viz;
  if (e.parameters) payload.parameters = e.parameters;
  if (e.height) payload.height = e.height;
  const h = (e.height ? String(e.height) : '430px').replace(/["']/g, '');
  return `<div data-question-inline="${serializeJsonAttr(payload)}" style="width:100%;height:${h}"></div>`;
}

const INLINE_Q_DIV_RE = /<div\s+([^>]*?data-question-inline="[^"]*"[^>]*?)>\s*<\/div>/g;

function payloadToEmbed(payload: Record<string, unknown> | null | undefined): InlineQuestionEmbed | null {
  const rawQuery = typeof payload?.query === 'string' ? payload.query : '';
  const spreadsheet = spreadsheetFromAttr(payload?.spreadsheet);
  if (!rawQuery && !spreadsheet) return null;
  const e: InlineQuestionEmbed = {
    connection: typeof payload?.connection_name === 'string' ? payload.connection_name : '',
  };
  // Defensive: also normalize on read, so any embed already stored with literal \n escapes
  // (authored before the fix) still parses + runs correctly.
  if (rawQuery) e.query = normalizeInlineQuery(rawQuery);
  if (spreadsheet) e.spreadsheet = spreadsheet;
  // `viz` (envelope) wins; a stored LEGACY `vizSettings` payload (pre-envelope story bodies)
  // is auto-upgraded so existing stories keep their charts. The upgrade persists on the next
  // save round-trip (the placeholder only ever writes `viz`).
  const env = vizEnvelopeFromAttr(payload?.viz) ?? (payload?.vizSettings ? inlineVizFromValue(payload.vizSettings, e.query) : undefined);
  if (env) e.viz = env;
  if (payload?.parameters) e.parameters = payload.parameters as QuestionParameter[];
  if (typeof payload?.height === 'string') e.height = payload.height;
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
const SAVED_Q_FULL_DIV_RE = /<div\s+data-question-id=["'](\d+)["']([^>]*)>\s*<\/div>/g;

/** Saved embed → the `<div data-question-id>` placeholder. A Viz V2 envelope override (when the
 *  story restyles the question WITHOUT editing the saved file) rides as `data-question-viz`. */
export function savedQuestionToPlaceholder(id: number, height?: string, viz?: VizEnvelope): string {
  const h = (height ? String(height) : '430px').replace(/["']/g, '');
  const vizAttr = viz ? ` data-question-viz="${serializeJsonAttr(viz)}"` : '';
  return `<div data-question-id="${id}"${vizAttr} style="width:100%;height:${h}"></div>`;
}

/** Read a saved embed's viz override from its rendered placeholder element (entity-decoded by the
 *  browser). Null when there is no override — the saved question's own viz then renders as-is. */
export function savedQuestionVizFromEl(el: { getAttribute(name: string): string | null }): VizEnvelope | null {
  return vizEnvelopeFromAttr(parseJsonAttr<unknown>(el.getAttribute('data-question-viz'))) ?? null;
}

/** Apply a story's viz override to a saved question's content: a FULL viz replace (the override
 *  envelope becomes authoritative; legacy vizSettings is suppressed so it can't leak through on
 *  fallback). No-op (same reference) without an override. */
export function applyVizOverride(content: QuestionContent, override: VizEnvelope | null | undefined): QuestionContent {
  if (!override) return content;
  return { ...content, viz: override, vizSettings: null };
}

const heightFromPlaceholderAttrs = (rest: string): string | undefined =>
  rest.match(/height:\s*([^;"']+)/)?.[1]?.trim();

/**
 * Set / replace / remove (viz=null) the viz override on the `occurrence`-th (0-based) saved
 * placeholder with `questionId`, preserving its height. Pure story-HTML transform — the modal's
 * write-back for a saved embed's story-level viz override.
 */
export function updateSavedQuestionVizInHtml(
  html: string, questionId: number, occurrence: number, viz: VizEnvelope | null,
): string {
  let seen = 0;
  return html.replace(SAVED_Q_FULL_DIV_RE, (whole, id: string, rest: string) => {
    if (Number(id) !== questionId || seen++ !== occurrence) return whole;
    return savedQuestionToPlaceholder(questionId, heightFromPlaceholderAttrs(rest), viz ?? undefined);
  });
}

/**
 * Replace the `index`-th (0-based, document order) inline-question placeholder with `embed`.
 * Pure story-HTML transform — the modal's write-back for an ephemeral question edit.
 */
export function updateInlineQuestionInHtml(html: string, index: number, embed: InlineQuestionEmbed): string {
  let seen = 0;
  return html.replace(INLINE_Q_DIV_RE, (whole) =>
    seen++ === index ? inlineQuestionToPlaceholder(embed) : whole);
}

/**
 * Set / replace / remove (viz=null) the viz override on the `<Question id={questionId}>` at
 * `astPath` in a jsx story body. The jsx counterpart of {@link updateSavedQuestionVizInHtml}:
 * the modal's write-back for a saved embed's story-level viz override. Returns the source
 * unchanged when the path doesn't resolve to a `<Question>` with that id (stale path).
 */
export function updateSavedQuestionVizInJsx(
  source: string, astPath: string, questionId: number, viz: VizEnvelope | null,
): string {
  return updateJsxElementAtPath(source, astPath, 'Question', (el) => {
    const id = el.attributes.find(a => a.name === 'id');
    if (!id?.value.static || id.value.json !== questionId) return false;
    setStaticJsxAttr(el, 'viz', viz === null ? undefined : (viz as unknown as JsonValue));
  });
}

/**
 * Replace the inline `<Question>` at `astPath` with `embed`'s definition, preserving unrelated
 * attributes (className, height when the embed carries none, …). The jsx counterpart of
 * {@link updateInlineQuestionInHtml}: the modal's write-back for an ephemeral question edit.
 * Returns the source unchanged when the path resolves to a saved (`id`) embed or nothing.
 */
export function updateInlineQuestionInJsx(source: string, astPath: string, embed: InlineQuestionEmbed): string {
  return updateJsxElementAtPath(source, astPath, 'Question', (el) => {
    if (el.attributes.some(a => a.name === 'id')) return false; // saved embed — not this transform's target
    setStaticJsxAttr(el, 'query', embed.query);
    setStaticJsxAttr(el, 'spreadsheet', embed.spreadsheet as unknown as JsonValue | undefined);
    setStaticJsxAttr(el, 'connection', embed.connection);
    setStaticJsxAttr(el, 'viz', embed.viz as unknown as JsonValue | undefined);
    setStaticJsxAttr(el, 'params', embed.parameters as unknown as JsonValue | undefined);
    setStaticJsxAttr(el, 'height', embed.height);
  });
}

/** Reverse of {@link inlineEmbedToQuestionContent}: an edited QuestionContent (from the modal's
 *  throwaway draft) back to the inline embed stored in the story body. A legacy-only content viz
 *  (the editor ran with Viz V2 off) is upgraded to an envelope; the projection's default table
 *  envelope is omitted so a viz-less embed stays viz-less in the markup. */
export function questionContentToInlineEmbed(c: QuestionContent, height?: string): InlineQuestionEmbed {
  const e: InlineQuestionEmbed = { connection: c.connection_name ?? '' };
  if (c.query) e.query = c.query;
  if (c.spreadsheet) e.spreadsheet = c.spreadsheet;
  const env = c.viz ?? (c.vizSettings ? inlineVizFromValue(c.vizSettings, c.query) : undefined);
  if (env && !isDefaultTableEnvelope(env)) e.viz = env;
  if (c.parameters?.length) e.parameters = c.parameters;
  if (height) e.height = height;
  return e;
}

/** Rewrite a story HTML's saved-question placeholders back to `<Question id=… />` jsx (for
 *  buildStoryJsx), preserving a viz override and a non-default height. */
export function placeholdersToSavedQuestionJsx(html: string | null | undefined): string {
  return (html ?? '').replace(SAVED_Q_FULL_DIV_RE, (_whole, id: string, rest: string) => {
    const a: string[] = [`id={${id}}`];
    const vm = rest.match(/data-question-viz="([^"]*)"/);
    const env = vm ? vizEnvelopeFromAttr(parseJsonAttr<unknown>(vm[1])) : undefined;
    if (env) a.push(`viz={${JSON.stringify(env)}}`);
    const h = heightFromPlaceholderAttrs(rest);
    if (h && h !== '430px') a.push(`height="${escAttr(h)}"`);
    return `<Question ${a.join(' ')} />`;
  });
}

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
  const a: string[] = [];
  if (e.query) a.push(`query={\`${escTemplate(e.query)}\`}`);
  if (e.spreadsheet) a.push(`spreadsheet={${JSON.stringify(e.spreadsheet)}}`);
  a.push(`connection="${escAttr(e.connection)}"`);
  if (e.viz) a.push(`viz={${JSON.stringify(e.viz)}}`);
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

/** Project an inline embed to a full QuestionContent the renderer/query stack consumes.
 *  The `viz` envelope is authoritative (a viz-less embed gets the default table envelope,
 *  matching a new question file); a `spreadsheet` renders directly (no SQL, query stays ''). */
export function inlineEmbedToQuestionContent(e: InlineQuestionEmbed): QuestionContent {
  return {
    description: null,
    query: e.query ?? '',
    connection_name: e.connection,
    vizSettings: null,
    viz: e.viz ?? DEFAULT_TABLE_ENVELOPE,
    spreadsheet: e.spreadsheet ?? null,
    parameters: e.parameters ?? [],
    parameterValues: null,
  };
}
