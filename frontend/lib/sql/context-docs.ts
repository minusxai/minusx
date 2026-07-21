/**
 * Context-doc resolution logic.
 *
 * Resolves a context's documentation (docs + generated "Schema Notes") for a
 * user's published (or explicitly requested) version — both as a single fully
 * serialized string (`getDocumentationForUser`, for prompt builders that don't
 * advertise a LoadContext tool) and as structured, lazily-loadable docs
 * (`resolveContextDocs` + `formatContextDocsSection` / `loadContextDocsByKeys`,
 * for interactive chat's on-demand Context Library).
 */
import { ContextContent, DocEntry, MetricDef, TableAnnotation, type ResolvedContextDoc, type ResolvedContextDocs } from '../types';
import type { SemanticModelV2, SemanticSource, SemanticReference, SemanticMetricV2 } from '../validation/atlas-schemas';
import { getPublishedVersionForUser } from '../context/context-utils';
import { CONTEXT_BUDGETS, PER_DOC_CONTENT_CHARS } from '../context/context-budgets';
import { budgetAnnotationNotes, backfillAnnotationConnections } from './annotation-notes';

/**
 * Build an agent-facing "Schema Notes" markdown section from context-authored
 * table/column descriptions and metrics. Returns undefined when there's nothing
 * to say. (Profiled column descriptions/stats reach the agent separately via the
 * SearchDBSchema tool; this surfaces the editorial context layer + metrics.)
 */
/** Render a semantic source compactly: `schema.table` for tables, `_views.<name>` for data models. */
function semanticSourceLabel(source: SemanticSource): string {
  if (source.kind === 'model') return `_views.${source.view}`;
  return source.schema ? `${source.schema}.${source.table}` : source.table;
}

/** One compact line per reference: `alias = <cardinality> <source> [THROUGH <bridge>] ON …`. */
function semanticReferenceLabel(ref: SemanticReference): string {
  if (ref.relationship === 'many_to_many') {
    const on = [
      ...ref.through.primaryOn.map((o) => `${o.primaryColumn}=${o.bridgeColumn}`),
      ...ref.through.referencedOn.map((o) => `${o.bridgeColumn}=${o.referencedColumn}`),
    ].join(', ');
    return `${ref.alias} = many_to_many ${semanticSourceLabel(ref.source)} THROUGH ${semanticSourceLabel(ref.through.source)} ON ${on}`;
  }
  const on = ref.on.map((o) => `${o.primaryColumn}=${o.referencedColumn}`).join(', ');
  return `${ref.alias} = ${ref.relationship} ${semanticSourceLabel(ref.source)} ON ${on}`;
}

function semanticMetricLabel(m: SemanticMetricV2): string {
  return m.type === 'ratio' ? `${m.name} = ${m.numerator} / ${m.denominator}` : `${m.name} = ${m.sql}`;
}

/**
 * Project one authored semantic model into a compact reference bullet for the
 * agent's free-SQL docs: name, primary, references (alias, cardinality, join
 * columns), dimensions (name → source.column), measures, and metric
 * definitions. UNVALIDATED documentation — helps the agent write correct joins
 * and metric SQL by hand; validated execution goes through semantic queries.
 */
function semanticModelToNote(model: SemanticModelV2): string {
  const parts: string[] = [];
  if (model.references && model.references.length > 0) {
    parts.push(`refs: ${model.references.map(semanticReferenceLabel).join('; ')}`);
  }
  if (model.dimensions.length > 0) {
    parts.push(`dims: ${model.dimensions.map((d) => `${d.name}=${d.source === 'primary' ? '' : `${d.source}.`}${d.column}`).join(', ')}`);
  }
  if (model.measures.length > 0) {
    parts.push(`measures: ${model.measures.map((m) => `${m.name}=${m.agg}(${m.column ?? '*'})`).join(', ')}`);
  }
  if (model.metrics && model.metrics.length > 0) {
    parts.push(`metrics: ${model.metrics.map(semanticMetricLabel).join(', ')}`);
  }
  const desc = model.description ? ` — ${model.description}` : '';
  const body = parts.length > 0 ? `: ${parts.join('; ')}` : '';
  return `- Semantic model "${model.name}" (connection ${model.connection}, primary ${semanticSourceLabel(model.primary)})${desc}${body}`;
}

function buildSchemaNotes(annotations: TableAnnotation[], metrics: MetricDef[], semanticModels: SemanticModelV2[] = []): string | undefined {
  const lines: string[] = [];

  const { lines: annLines, droppedTables, droppedColumns } = budgetAnnotationNotes(annotations);
  if (annLines.length > 0 || droppedTables > 0) {
    lines.push('### Tables & Columns', 'Note: These descriptions were specially noted by the context authors.', ...annLines);
    if (droppedTables > 0) {
      let note = `- …and ${droppedTables} more annotated table(s)`;
      if (droppedColumns > 0) note += ` (${droppedColumns} more column note(s))`;
      note += ' omitted to fit the context budget — inspect specific tables with the SearchDBSchema tool.';
      lines.push(note);
    }
  }

  const metricLines = metrics.map((m) => {
    const loc = m.schema && m.table ? ` [${m.schema}.${m.table}]` : '';
    const desc = m.description ? ` — ${m.description}` : '';
    const sql = m.sql ? `\n  \`\`\`sql\n  ${m.sql.replace(/\n/g, '\n  ')}\n  \`\`\`` : '';
    return `- ${m.name}${loc}${desc}${sql}`;
  });
  if (metricLines.length > 0) lines.push('### Metrics', 'Note: These metrics were specially noted by the context authors. Pay attention to the SQL definitions, if available.', ...metricLines);

  const modelLines = semanticModels.map(semanticModelToNote);
  if (modelLines.length > 0) {
    lines.push(
      '### Semantic Models',
      'Note: Authored semantic models — use their references as join documentation and their measure/metric definitions as the canonical formulas when writing SQL. Metric SQL qualifies columns as primary.<col> / <alias>.<col> relative to the model, not as runnable table names.',
      ...modelLines,
    );
  }

  return lines.length > 0 ? `## Schema Notes\n\n${lines.join('\n')}` : undefined;
}

/**
 * Serialize a doc entry to its agent-facing string, prepending the optional
 * title/description when present (both default to absent and are skipped).
 */
function docEntryToString(doc: DocEntry | string): string {
  if (typeof doc === 'string') return doc;
  const header = [
    doc.title ? `# ${doc.title}` : null,
    doc.description ? doc.description : null,
  ].filter(Boolean).join('\n\n');
  return header ? `${header}\n\n${doc.content}` : doc.content;
}

/**
 * Resolve the user's published version + the merged non-draft doc list (inherited
 * docs first, then own docs) and the inline Schema Notes section. Shared by the
 * full serializer (getDocumentationForUser) and the lazy resolver
 * (resolveContextDocs).
 */
function collectContextDocs(
  contextContent: ContextContent,
  userId: number,
  version?: number,
): {
  docs: (DocEntry | string)[];
  schemaNotes: string | undefined;
} {
  // Inherited docs (fullDocs) — already filtered by childPaths at load time.
  const inheritedDocs = (contextContent.fullDocs || [])
    .filter(doc => typeof doc === 'string' || doc.draft !== true);

  // Resolve the requested version (admin testing a specific version) or the
  // user's published version. Fall back to published when the requested version
  // doesn't exist.
  const targetVersion = version ?? getPublishedVersionForUser(contextContent, userId);
  const selectedVersion = contextContent.versions && contextContent.versions.length > 0
    ? (contextContent.versions.find(v => v.version === targetVersion)
        ?? contextContent.versions.find(v => v.version === getPublishedVersionForUser(contextContent, userId)))
    : undefined;

  const ownDocs = (selectedVersion?.docs || [])
    .filter(doc => typeof doc === 'string' || doc.draft !== true);

  // Schema Notes: context-authored descriptions + metrics (own + inherited).
  // Legacy annotations may lack a `connection`; infer it from the available
  // schema (unambiguous matches only) so the head line can show [connection].
  const rawAnnotations = [...(contextContent.fullAnnotations || []), ...(selectedVersion?.annotations || [])];
  const annotations = backfillAnnotationConnections(rawAnnotations, contextContent.fullSchema);
  const metrics = [...(contextContent.fullMetrics || []), ...(selectedVersion?.metrics || [])];
  const semanticModels = [...(contextContent.fullSemanticModels || []), ...(selectedVersion?.semanticModels || [])];
  const schemaNotes = buildSchemaNotes(annotations, metrics, semanticModels);

  return { docs: [...inheritedDocs, ...ownDocs], schemaNotes };
}

/**
 * Get documentation for a user's published version — FULL serialization of every
 * (non-draft) doc inline. Used by benchmark/headless prompt builders that don't
 * advertise the LoadContext tool. Interactive chat uses resolveContextDocs instead.
 *
 * @param contextContent - The context content with versions
 * @param userId - The user ID to get the published version for
 * @returns Documentation string or undefined
 */
export function getDocumentationForUser(
  contextContent: ContextContent,
  userId: number
): string | undefined {
  const { docs, schemaNotes } = collectContextDocs(contextContent, userId);
  const allDocStrings = [...docs.map(docEntryToString), schemaNotes].filter(Boolean);
  return allDocStrings.length > 0 ? allDocStrings.join('\n\n---\n\n') : undefined;
}

// Resolved-doc types live in `@/lib/types`; re-exported here for import sites that
// reach for them via context-docs.
export type { ResolvedContextDoc, ResolvedContextDocs } from '../types';

/**
 * Slugify a doc title into a stable, easy-to-pass key: lowercased, non-alphanumeric
 * runs collapsed to underscores, trimmed. Returns '' for an empty/punctuation-only
 * title (caller assigns a fallback).
 */
function slugifyDocKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Derive a title + description from a doc's body, for legacy docs saved before
 * title/description were required: first non-empty line → title (markdown heading
 * markers stripped), next two non-empty lines → description. New docs are required
 * to carry an explicit title + description (enforced in the context editor), so
 * this only fires for older data.
 */
function deriveDocMeta(content: string): { title: string; description: string } {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const title = lines[0] ? lines[0].replace(/^#+\s*/, '').trim() : '';
  const description = lines.slice(1, 3).join(' ');
  return { title, description };
}

/**
 * Below this many total (active) docs, lazy-loading buys nothing — they're all
 * inlined (Default Context Docs) so the agent never has to spend a LoadContext
 * call. At/above it, only the explicitly-pinned (alwaysInclude) docs inline; the
 * rest go to the on-demand catalog. This is a presentation decision, so it lives
 * in `formatContextDocsSection`, not in the structure produced here.
 */
export const INLINE_ALL_DOCS_THRESHOLD = CONTEXT_BUDGETS.inlineAllDocsThreshold;

/** Shown under "Context Library" when there are no lazy docs to load on demand. */
const EMPTY_CONTEXT_LIBRARY_TEXT = 'No additional context documents are available.';

/**
 * Resolve a context's docs into STRUCTURE (one list, each tagged alwaysInclude)
 * plus the generated schema notes. No presentation — turn it into text only in
 * `formatContextDocsSection`. Lazy docs without an explicit title/description fall
 * back to one derived from their body (see deriveDocMeta) so legacy data stays
 * loadable. Pass `version` to resolve a specific (e.g. admin-tested) version's
 * docs instead of the user's published version.
 */
export function resolveContextDocs(
  contextContent: ContextContent,
  userId: number,
  version?: number,
): ResolvedContextDocs {
  const { docs, schemaNotes } = collectContextDocs(contextContent, userId, version);

  const resolved: ResolvedContextDoc[] = [];
  const usedKeys = new Set<string>();
  let fallbackCount = 0;

  for (const doc of docs) {
    // alwaysInclude docs (and bare string docs, which are pinned by definition)
    // are inlined verbatim every turn — no key, explicit title/description only.
    if (typeof doc === 'string') {
      resolved.push({ key: '', title: '', content: doc, alwaysInclude: true });
      continue;
    }
    if (doc.alwaysInclude === true) {
      resolved.push({
        key: slugifyDocKey(doc.title?.trim() ?? ''),
        title: doc.title?.trim() ?? '',
        description: doc.description?.trim() || undefined,
        content: doc.content,
        alwaysInclude: true,
      });
      continue;
    }

    // Lazy doc — prefer the explicit title/description, deriving from the body
    // only when one is missing (legacy docs).
    const content = doc.content;
    let title = doc.title?.trim() ?? '';
    let description = doc.description?.trim() ?? '';
    if (!title || !description) {
      const derived = deriveDocMeta(content);
      if (!title) title = derived.title;
      if (!description) description = derived.description;
    }
    if (!title) title = `Document ${++fallbackCount}`;

    // The key is a stable slug derived from the title; the agent sees the title
    // (+ description) for relevance and passes the key to LoadContext.
    const baseKey = slugifyDocKey(title) || `document_${++fallbackCount}`;
    let key = baseKey;
    for (let n = 2; usedKeys.has(key); n++) key = `${baseKey}_${n}`;
    usedKeys.add(key);
    resolved.push({ key, title, description: description || undefined, content, alwaysInclude: false });
  }

  return { docs: resolved, schemaNotes: schemaNotes || undefined };
}

/**
 * Per-doc render safety net: cap an inlined doc's body at PER_DOC_CONTENT_CHARS
 * (derived from CONTEXT_BUDGETS.perDocTokens). The editor blocks saving docs over
 * this, but legacy/oversized docs can still exist — truncate them with a pointer
 * to fetch the full text via LoadContext rather than blow the prompt.
 */
export function clampDocContent(content: string, key: string, maxChars: number = PER_DOC_CONTENT_CHARS): string {
  if (content.length <= maxChars) return content;
  const kept = content.slice(0, maxChars).trimEnd();
  return `${kept}\n\n…[doc truncated to ~${CONTEXT_BUDGETS.perDocTokens} tokens — load the full text via LoadContext (key: "${key}")]`;
}

/** Render an always-include doc's inline body (optional title/description header + content). */
function renderResolvedDocInline(doc: ResolvedContextDoc): string {
  const header = [`**key**: "${doc.key}"`, doc.title ? `**title**: ${doc.title}` : null, doc.description ? `**description**: ${doc.description}` : null].filter(Boolean).join('\n\n');
  const content = clampDocContent(doc.content, doc.key);
  return header ? `${header}\n\n${content}` : content;
}

/**
 * The always-inline documentation as a plain string (alwaysInclude doc bodies +
 * schema notes), with NO section header. For the benchmark/eval/report paths that
 * carry docs as a single string and have no LoadContext tool — they only see the
 * always-include docs, same as before this was structured.
 */
export function inlineContextDocsText(resolved: ResolvedContextDocs): string {
  const parts = resolved.docs.filter((d) => d.alwaysInclude).map(renderResolvedDocInline);
  if (resolved.schemaNotes) parts.push(resolved.schemaNotes);
  return parts.filter(Boolean).join('\n\n---\n\n');
}

/**
 * Soft over-fetch nudge: if a single LoadContext call requests at least this many
 * docs, return them but warn the agent to be more selective. Absolute (not a
 * fraction of the library) since contexts often start with only 1-2 docs.
 */
const LOAD_CONTEXT_MAX_KEYS_BEFORE_WARNING = 5;

export interface LoadContextResult {
  /** JSON payload returned to the caller verbatim (tool result / MCP text). */
  payload: {
    success: boolean;
    docs?: { key: string; title: string; content: string }[];
    missing?: string[];
    warning?: string;
    error?: string;
  };
  /** True only for the empty-keys / empty-library error cases. */
  isError: boolean;
}

/**
 * Resolve Context Library keys to their full doc content. The single source of the
 * LoadContext behaviour — shared by the LoadContext MXTool (web/slack agents) and
 * the MCP LoadContext tool, so key/title resolution and the over-fetch nudge never
 * drift between the two surfaces.
 *
 * Only lazy (non-alwaysInclude) docs are loadable — alwaysInclude docs are already
 * inline in the prompt/instructions. Falls back to a UNIQUE human title when the
 * caller passes the title instead of the key. Unknown keys go to `missing` (not an
 * error); empty keys / no library are the only hard errors.
 */
export function loadContextDocsByKeys(
  resolved: ResolvedContextDocs | undefined,
  keys: string[],
): LoadContextResult {
  const library = (resolved?.docs ?? []).filter((d) => !d.alwaysInclude);

  if (keys.length === 0) {
    return { payload: { success: false, error: 'LoadContext requires at least one document key' }, isError: true };
  }
  if (library.length === 0) {
    return { payload: { success: false, error: 'No context documents are available to load' }, isError: true };
  }

  const byKey = new Map(library.map((d) => [d.key, d]));
  // Title fallback: only resolve titles that uniquely identify one doc (keys are
  // always unique; titles need not be).
  const titleCounts = new Map<string, number>();
  for (const d of library) {
    const t = d.title.trim().toLowerCase();
    titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
  }
  const byTitle = new Map(
    library
      .filter((d) => titleCounts.get(d.title.trim().toLowerCase()) === 1)
      .map((d) => [d.title.trim().toLowerCase(), d]),
  );

  const docs: { key: string; title: string; content: string }[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = byKey.get(key) ?? byTitle.get(key.trim().toLowerCase());
    if (entry) docs.push({ key: entry.key, title: entry.title, content: entry.content });
    else missing.push(key);
  }

  const payload: LoadContextResult['payload'] = { success: true, docs };
  if (missing.length > 0) payload.missing = missing;
  if (docs.length >= LOAD_CONTEXT_MAX_KEYS_BEFORE_WARNING) {
    payload.warning = `You loaded ${docs.length} documents at once. In future, load only the docs relevant to the user's question.`;
  }
  return { payload, isError: false };
}

/**
 * Render the Context Library catalog lines from the lazy docs. Each line gives the
 * key the agent passes to LoadContext, then the human title (+ description). This
 * is the ONLY place catalog text is produced.
 */
function formatContextLibraryCatalog(lazyDocs: ResolvedContextDoc[]): string {
  return lazyDocs
    .map((d) => `  - **key**: \`${d.key}\` \n**title**: ${d.title}${d.description ? `\n**description**: ${d.description}` : ''}`)
    .join('\n');
}

/**
 * Format a context's resolved docs into the exact "## Context" body shown both to
 * the agent (system prompt) and to the user (docs sidebar): always-inline docs
 * under "Default Context Docs", lazy docs under "Context Library (to be loaded on
 * demand)". This is the SINGLE source of truth for that layout — the prompt
 * render and the sidebar both call it so the two can never drift.
 *
 * Takes the STRUCTURE (`resolveContextDocs`'s output) and produces text here, in
 * one pass: inlined docs (+ schema notes) under "Default Context Docs", lazy docs
 * as catalog lines under "Context Library". The catalog falls back to a fixed
 * "nothing to load" line, so the agent always sees an explicit Context Library
 * section even when there are no docs (the sidebar gates on having docs before
 * calling this, so it never renders a bare fallback).
 */
export function formatContextDocsSection(
  resolved: { docs?: ResolvedContextDoc[]; schemaNotes?: string },
): string {
  const docs = resolved.docs ?? [];
  const parts: string[] = [];

  // Small context: lazy-loading buys nothing, so inline every doc rather than
  // advertise a catalog the agent would have to spend a LoadContext call to read.
  const inlineAll = docs.length < INLINE_ALL_DOCS_THRESHOLD;
  const isInline = (d: ResolvedContextDoc) => inlineAll || d.alwaysInclude;

  // Default Context Docs: inlined doc bodies, then the schema notes.
  const inlineParts = docs.filter(isInline).map(renderResolvedDocInline);
  if (resolved.schemaNotes) inlineParts.push(resolved.schemaNotes);
  const inline = inlineParts.filter(Boolean).join('\n\n---\n\n');
  if (inline.trim()) parts.push(`### Default Context Docs\n\n${inline}`);

  // Context Library: the lazy docs, advertised by key + title (+ description), or
  // a fixed "nothing to load" line when everything is inlined.
  const catalog = formatContextLibraryCatalog(docs.filter((d) => !isInline(d)));
  const catalogBody = catalog.trim() ? catalog : EMPTY_CONTEXT_LIBRARY_TEXT;
  parts.push(`---\n### Context Library \n\nNote: These can be loaded on demand via the \`key\`.\n\n${catalogBody}`);

  return parts.join('\n\n');
}
