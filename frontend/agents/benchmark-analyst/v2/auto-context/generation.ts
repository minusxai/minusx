/**
 * AutoContext — parse, verify, and render the agent's output.
 *
 * Phase 3 of the AutoContext pipeline (see `auto-context.ts` for the
 * overview): given the raw `AutoContextAgent` conversation log, this module
 * -
 *   1. `parseAnnotations` — extracts + sanity-filters the `SubmitSchemaInfo`
 *      payload (drops annotations/joins referencing IDs not in the catalog).
 *   2. `verifyJoinsMechanically` (+ `probeJoinUsingConnectors`) — re-probes
 *      every claimed join against the real connectors; the agent's say-so
 *      alone is never trusted.
 *   3. `renderGeneratedContext` — merges the verified payload into the
 *      canonical catalog and renders the `<GeneratedContext>` Markdown block
 *      the analyst's system prompt embeds.
 */
import 'server-only';

import type { ColumnMeta, NodeConnector } from '@/lib/connections/base';
import type { ConversationLogEntry } from '@/orchestrator/types';
import {
  colKey,
  groupByTable,
  packBlocksWithNote,
  renderStats,
  type IdMap,
  type TableGroup,
} from './catalog-render';
import { SubmitSchemaInfo, type Annotation, type AutoContextPayload } from './agent';
import type { FlatColumn } from './schema';

// ─── parseAnnotations + agent-side validation ───────────────────────────────

interface RawAnnotation {
  id?: unknown;
  description?: unknown;
  join?: unknown;
}

/**
 * Walk the orchestrator log for the SubmitSchemaInfo toolResult emitted by
 * the AutoContextAgent invocation under `agentId`, parse its payload, and
 * filter against the supplied `IdMap`:
 *
 *   - drop annotations whose `id` isn't in the catalog (hallucinations);
 *   - drop `join.to` references whose target id isn't in the catalog;
 *   - drop annotations with no useful payload left after filtering (no
 *     description AND no surviving join).
 *
 * Returns `null` when the agent never emitted a SubmitSchemaInfo result
 * under this `agentId`, or when the result's details have the wrong shape.
 */
export function parseAnnotations(
  log: ConversationLogEntry[],
  agentId: string,
  idMap: IdMap,
): AutoContextPayload | null {
  for (const entry of log) {
    if (!('role' in entry) || entry.role !== 'toolResult') continue;
    if (entry.parent_id !== agentId) continue;
    if (entry.toolName !== SubmitSchemaInfo.schema.name) continue;

    const details = entry.details as { type?: string; payload?: { annotations?: RawAnnotation[] } } | undefined;
    if (details?.type !== 'auto_context' || !details.payload) return null;
    const raw = details.payload.annotations;
    if (!Array.isArray(raw)) return { annotations: [] };

    const filtered: Annotation[] = [];
    for (const ann of raw) {
      if (typeof ann.id !== 'string' || !idMap.byId(ann.id)) continue;
      const description = typeof ann.description === 'string' && ann.description.length > 0
        ? ann.description
        : undefined;
      let join: { to: string } | undefined;
      if (ann.join && typeof ann.join === 'object') {
        const to = (ann.join as { to?: unknown }).to;
        if (typeof to === 'string' && idMap.byId(to)) {
          join = { to };
        }
      }
      if (!description && !join) continue;
      const cleaned: Annotation = { id: ann.id };
      if (description !== undefined) cleaned.description = description;
      if (join) cleaned.join = join;
      filtered.push(cleaned);
    }
    return { annotations: filtered };
  }
  return null;
}

// ─── verifyJoinsMechanically ─────────────────────────────────────────────────

/** Canonical endpoint of a join (a fully-qualified column path). */
export interface JoinEndpoint {
  connection: string;
  schema: string;
  table: string;
  column: string;
}

/**
 * Probe one candidate join. The probe should run a COUNT(*) (or equivalent)
 * against the from-side joined to the to-side and report whether the result
 * was non-zero. Errors should be caught by the implementation and surfaced
 * as `ok: false` — `verifyJoinsMechanically` will treat anything other than
 * `ok: true` as a failed verification.
 *
 * Same-connection vs cross-connection routing happens inside the
 * implementation (`from.connection === to.connection` is the discriminator).
 */
export type JoinProbe = (from: JoinEndpoint, to: JoinEndpoint) => Promise<{ ok: boolean }>;

function endpointFromId(idMap: IdMap, id: string): JoinEndpoint | null {
  const entry = idMap.byId(id);
  if (!entry || entry.type !== 'column') return null;
  if (!entry.schema || !entry.table || !entry.column) return null;
  return {
    connection: entry.connection,
    schema: entry.schema,
    table: entry.table,
    column: entry.column,
  };
}

/**
 * Re-validate every join in the payload by running a deterministic probe.
 * Joins whose probe doesn't return ok=true are dropped from the annotation
 * (the description, if any, is preserved). Annotations whose only payload
 * was a now-dropped join are removed entirely.
 *
 * The downstream analyst trusts every join in the rendered output as
 * ground-truth FK, so unverified entries must not survive this pass.
 */
export async function verifyJoinsMechanically(
  payload: AutoContextPayload,
  idMap: IdMap,
  probe: JoinProbe,
): Promise<AutoContextPayload> {
  const results: Annotation[] = [];
  // Probe each join in parallel — they're independent queries.
  const verifications = await Promise.all(
    payload.annotations.map(async (ann) => {
      if (!ann.join) return { ann, joinOk: false };
      const from = endpointFromId(idMap, ann.id);
      const to = endpointFromId(idMap, ann.join.to);
      if (!from || !to) return { ann, joinOk: false };
      try {
        const { ok } = await probe(from, to);
        return { ann, joinOk: ok };
      } catch {
        return { ann, joinOk: false };
      }
    }),
  );

  for (const { ann, joinOk } of verifications) {
    const cleaned: Annotation = { id: ann.id };
    if (ann.description) cleaned.description = ann.description;
    if (ann.join && joinOk) cleaned.join = ann.join;
    // Keep only if at least one of description / verified join survived.
    if (cleaned.description || cleaned.join) results.push(cleaned);
  }

  return { annotations: results };
}

/** Quote a SQL identifier for double-quoted dialects (Postgres / DuckDB / SQLite). */
function qi(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a SQL literal value (single-quoted, with embedded-quote escaping). */
function ql(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Probe one candidate join against the actual data. Same-connection runs a
 *  COUNT(*) JOIN; cross-connection fetches distinct values from src then
 *  checks dst via WHERE IN (cheap chaining without `_scratch`). Returns
 *  `{ok: false}` on any SQL error. */
export async function probeJoinUsingConnectors(
  connectors: Map<string, NodeConnector>,
  from: JoinEndpoint,
  to: JoinEndpoint,
): Promise<{ ok: boolean }> {
  const sameConn = from.connection === to.connection && from.schema === to.schema;
  if (sameConn) {
    const conn = connectors.get(from.connection);
    if (!conn) return { ok: false };
    const fromTable = `${qi(from.schema)}.${qi(from.table)}`;
    const toTable = `${qi(to.schema)}.${qi(to.table)}`;
    const sql = `SELECT 1 FROM ${fromTable} a JOIN ${toTable} b ON a.${qi(from.column)} = b.${qi(to.column)} LIMIT 1`;
    try {
      const result = await conn.query(sql);
      return { ok: (result.rows?.length ?? 0) > 0 };
    } catch {
      return { ok: false };
    }
  }
  // Cross-connection: fetch distinct src values, check dst via WHERE IN.
  const fromConn = connectors.get(from.connection);
  const toConn = connectors.get(to.connection);
  if (!fromConn || !toConn) return { ok: false };
  const fromTable = `${qi(from.schema)}.${qi(from.table)}`;
  const toTable = `${qi(to.schema)}.${qi(to.table)}`;
  try {
    const srcResult = await fromConn.query(
      `SELECT DISTINCT ${qi(from.column)} AS v FROM ${fromTable} WHERE ${qi(from.column)} IS NOT NULL LIMIT 200`,
    );
    const values = (srcResult.rows ?? []).map((r) => (r as Record<string, unknown>).v).filter((v) => v != null);
    if (values.length === 0) return { ok: false };
    const inList = values.map(ql).join(', ');
    const dstResult = await toConn.query(
      `SELECT 1 FROM ${toTable} WHERE ${qi(to.column)} IN (${inList}) LIMIT 1`,
    );
    return { ok: (dstResult.rows?.length ?? 0) > 0 };
  } catch {
    return { ok: false };
  }
}

// ─── renderGeneratedContext (merge + Markdown) ───────────────────────────────

function escapeMd(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Soft cap on the rendered `<GeneratedContext>` block injected into the
 *  analyst's system prompt. Leaves room for the rest of the prompt + the
 *  user message + chart attachments. */
export const DEFAULT_GENERATED_CONTEXT_MAX_CHARS = 60_000;

/** Output detail tiers, leanest last. `full` shows stats + every column;
 *  `no-stats` drops the stats column; `essential` keeps only annotated
 *  columns (collapsing the rest to a count) — the descriptions + verified
 *  joins AutoContext spent an LLM call to produce are the last thing shed. */
type OutputTier = 'full' | 'no-stats' | 'essential';

interface ResolvedColumn {
  column: string;
  type: string;
  desc: string;
  joinCell: string;
  annotated: boolean;
}

function resolveColumns(
  t: TableGroup,
  idMap: IdMap,
  annById: Map<string, Annotation>,
): ResolvedColumn[] {
  return t.columns.map((c) => {
    const cId = idMap.byPath(colKey(c))?.id;
    const ann = cId ? annById.get(cId) : undefined;
    const desc = ann?.description ? escapeMd(ann.description) : '';
    let joinCell = '';
    if (ann?.join) {
      const target = idMap.byId(ann.join.to);
      if (target && target.table && target.column) joinCell = `→ ${target.table}.${target.column}`;
    }
    return { column: c.column, type: c.type, desc, joinCell, annotated: Boolean(desc || joinCell) };
  });
}

/** Render one table section at the requested tier. */
function renderTableSection(
  t: TableGroup,
  idMap: IdMap,
  statsByCol: Map<string, ColumnMeta>,
  rowCountByTable: Map<string, number>,
  annById: Map<string, Annotation>,
  tier: OutputTier,
): string {
  const tablePath = `${t.connection}.${t.schema}.${t.table}`;
  const tableId = idMap.byPath(tablePath)?.id;
  const tableAnn = tableId ? annById.get(tableId) : undefined;
  const rowCount = rowCountByTable.get(tablePath);
  const headerSuffix = rowCount !== undefined ? ` (${rowCount} rows)` : '';
  const headerDesc = tableAnn?.description ? ` — ${tableAnn.description}` : '';
  const header = `## ${tablePath}${headerSuffix}${headerDesc}`;
  const cols = resolveColumns(t, idMap, annById);

  if (tier === 'essential') {
    const annotated = cols.filter((c) => c.annotated);
    const hidden = cols.length - annotated.length;
    if (annotated.length === 0) {
      return `${header}\n\n_${cols.length} columns — use \`SearchDBSchema\` to inspect._`;
    }
    const lines = [header, '', '| col | type | description | joins |', '|---|---|---|---|'];
    for (const c of annotated) lines.push(`| ${c.column} | ${c.type} | ${c.desc} | ${c.joinCell} |`);
    if (hidden > 0) lines.push(`| _+${hidden} more columns (use \`SearchDBSchema\`)_ | | | |`);
    return lines.join('\n');
  }

  const includeStats = tier === 'full';
  const lines = includeStats
    ? [header, '', '| col | type | stats | description | joins |', '|---|---|---|---|---|']
    : [header, '', '| col | type | description | joins |', '|---|---|---|---|'];
  for (const c of cols) {
    if (includeStats) {
      const stats = renderStats(statsByCol.get(`${t.connection}.${t.schema}.${t.table}.${c.column}`));
      lines.push(`| ${c.column} | ${c.type} | ${stats} | ${c.desc} | ${c.joinCell} |`);
    } else {
      lines.push(`| ${c.column} | ${c.type} | ${c.desc} | ${c.joinCell} |`);
    }
  }
  return lines.join('\n');
}

const generatedBoundedNote = (kept: number, total: number): string => [
  '> Note: This generated context was bounded to fit the analyst\'s context window.',
  `> It covers ${kept} of ${total} tables; ${total - kept} omitted. Use \`SearchDBSchema\` to inspect them.`,
].join('\n');

/**
 * Merge the (verified) payload into the canonical catalog and render the
 * Markdown the analyst sees in `<GeneratedContext>`.
 *
 *   - Each table gets a `## <conn>.<schema>.<table> (N rows) — <tableDesc?>` header.
 *   - Each column is a Markdown-table row with `col | type | stats |
 *     description | joins`, populated from `ColumnMeta` and the payload
 *     annotations. Verified joins render as `→ <toTable>.<toColumn>`.
 *
 * Graded degradation, annotation-first: descriptions + verified joins are
 * the irrecoverable value-add (the analyst can re-derive stats and column
 * lists via SearchDBSchema/ExecuteQuery), so when the full render overflows
 * `maxChars` we shed the stats column, then unannotated columns (collapsed
 * to a count), then whole trailing tables with a recovery `> Note:`.
 *
 * Returns the block as a string (no surrounding tag — the caller wraps it).
 */
export function renderGeneratedContext(
  schema: FlatColumn[],
  idMap: IdMap,
  statsByCol: Map<string, ColumnMeta>,
  rowCountByTable: Map<string, number>,
  payload: AutoContextPayload,
  maxChars: number = DEFAULT_GENERATED_CONTEXT_MAX_CHARS,
): string {
  // Index annotations by id (last write wins on duplicate ids).
  const annById = new Map<string, Annotation>();
  for (const a of payload.annotations) annById.set(a.id, a);

  const tables = groupByTable(schema);
  const render = (tier: OutputTier): string[] =>
    tables.map((t) => renderTableSection(t, idMap, statsByCol, rowCountByTable, annById, tier));

  for (const tier of ['full', 'no-stats', 'essential'] as const) {
    const body = render(tier).join('\n\n');
    if (body.length <= maxChars) return body;
  }

  // Even the essential tier overflows — drop trailing tables, note the rest.
  return packBlocksWithNote(render('essential'), tables.length, maxChars, '\n\n', generatedBoundedNote);
}
