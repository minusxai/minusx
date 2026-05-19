/**
 * AutoContext: orientation layer for BenchmarkAnalystAgent.
 *
 * The agent runs once per (datasetKey, slot), observes the catalog,
 * annotates non-self-evident columns + verified joins, and returns a
 * structured payload that we merge into the canonical catalog tree and
 * render as a single Markdown block under `<GeneratedContext>` in the
 * analyst's system prompt.
 *
 * Everything lives in this file by design — orchestration, agent class,
 * tool definitions, parsing, verification, rendering. The BenchmarkAnalystAgent
 * integration is a thin shell that imports `ensureAutoContext(this)` and
 * `renderGeneratedContext(this)`.
 */
import 'server-only';

import {
  Type,
  type AssistantMessage,
  type Static,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import type { ColumnMeta, NodeConnector } from '@/lib/connections/base';
import {
  MXAgent,
  MXTool,
  type ConversationLogEntry,
  type ToolResponse,
} from '@/orchestrator/types';
import type { Orchestrator } from '@/orchestrator/orchestrator';
import { EMPTY_USAGE, gen_id } from '@/orchestrator/utils';
import { ChainedExecuteQuery } from '../../db-tools';
import type { BenchmarkAnalystContext } from '../../types';
import { publicConnectionMetadata } from '../../types';
import { getOrCreateBenchmarkConnector } from '../../shared-duckdb';
import { getCatalogStore } from '../catalog';
import { getLighterModel } from '../data-tool-base';
import { catalogProjection } from './catalog-summary';
import type { FlatColumn } from './schema';

// ─── Types — IDs + catalog elements ─────────────────────────────────────────

export type ElementType = 'connection' | 'schema' | 'table' | 'column';

/**
 * An identified element in the catalog tree. The agent references columns
 * (and occasionally tables) by `id` when emitting annotations; we use
 * `byPath` / `byId` to resolve those back to concrete catalog locations
 * before mechanical verification and Markdown rendering.
 */
export interface CatalogId {
  id: string;
  type: ElementType;
  connection: string;
  schema?: string;
  table?: string;
  column?: string;
}

/**
 * Bidirectional ID lookup over a flattened catalog schema. IDs are short
 * alphanumeric strings (`^[gstc][0-9]+$`) — `g` for connection, `s` for
 * schema, `t` for table, `c` for column. Assignment order follows the
 * insertion order of the input `FlatColumn[]`, so IDs are deterministic
 * for a given catalog projection.
 */
export interface IdMap {
  all(): CatalogId[];
  byId(id: string): CatalogId | undefined;
  byPath(path: string): CatalogId | undefined;
}

// ─── Slice 1: assignCatalogIds ──────────────────────────────────────────────

/** Canonical dotted path: `conn[.schema[.table[.column]]]`. */
function canonicalPath(e: CatalogId): string {
  return [e.connection, e.schema, e.table, e.column].filter(Boolean).join('.');
}

/**
 * Walk a `FlatColumn[]` catalog projection in insertion order and assign
 * a unique short ID to every connection, schema, table, and column. The
 * resulting `IdMap` is the only handle downstream code needs to translate
 * between agent-emitted IDs and canonical catalog paths.
 *
 * Insertion order is preserved per element class:
 *   - `g0`, `g1`, ... in the order connections first appear
 *   - `s0`, `s1`, ... in the order (connection, schema) pairs first appear
 *   - `t0`, `t1`, ... per (connection, schema, table)
 *   - `c0`, `c1`, ... per (connection, schema, table, column)
 *
 * Same input → same IDs (catalog rows are deterministic at the source).
 */
export function assignCatalogIds(schema: FlatColumn[]): IdMap {
  const all: CatalogId[] = [];
  const byPath = new Map<string, CatalogId>();
  const byId = new Map<string, CatalogId>();

  let gCounter = 0;
  let sCounter = 0;
  let tCounter = 0;
  let cCounter = 0;

  const ensure = (entry: Omit<CatalogId, 'id'> & { id?: string }, idPrefix: string, counter: () => string): CatalogId => {
    const path = canonicalPath(entry as CatalogId);
    const existing = byPath.get(path);
    if (existing) return existing;
    const created: CatalogId = { ...entry, id: counter() };
    byPath.set(path, created);
    byId.set(created.id, created);
    all.push(created);
    return created;
    void idPrefix;
  };

  for (const c of schema) {
    ensure({ type: 'connection', connection: c.connection }, 'g', () => `g${gCounter++}`);
    ensure({ type: 'schema', connection: c.connection, schema: c.schema }, 's', () => `s${sCounter++}`);
    ensure({ type: 'table', connection: c.connection, schema: c.schema, table: c.table }, 't', () => `t${tCounter++}`);
    ensure({ type: 'column', connection: c.connection, schema: c.schema, table: c.table, column: c.column }, 'c', () => `c${cCounter++}`);
  }

  return {
    all: () => all.slice(),
    byId: (id) => byId.get(id),
    byPath: (path) => byPath.get(path),
  };
}

// ─── Slice 2: renderCatalogForAgent ─────────────────────────────────────────

/** Soft cap on the rendered catalog the agent receives as `userMessage`.
 *  Picked to leave room for the agent's system prompt + tool descriptions +
 *  response space under typical lighter-model context windows. */
export const DEFAULT_CATALOG_RENDER_MAX_CHARS = 80_000;

function colKey(c: FlatColumn): string {
  return `${c.connection}.${c.schema}.${c.table}.${c.column}`;
}
function tableKey(t: { connection: string; schema: string; table: string }): string {
  return `${t.connection}.${t.schema}.${t.table}`;
}

function renderStats(meta: ColumnMeta | undefined): string {
  if (!meta) return '';
  const bits: string[] = [];
  if (meta.nDistinct !== undefined) bits.push(`nDistinct=${meta.nDistinct}`);
  if (meta.nullCount !== undefined && meta.nullCount > 0) bits.push(`nullCount=${meta.nullCount}`);
  if (meta.min !== undefined && meta.max !== undefined) bits.push(`min=${meta.min} max=${meta.max}`);
  if (meta.topValues && meta.topValues.length > 0) {
    const top = meta.topValues.slice(0, 3).map((t) => JSON.stringify(t.value)).join(', ');
    bits.push(`top=[${top}]`);
  }
  return bits.join(' ');
}

interface TableGroup {
  connection: string;
  schema: string;
  table: string;
  columns: FlatColumn[];
}

function groupByTable(schema: FlatColumn[]): TableGroup[] {
  const map = new Map<string, TableGroup>();
  for (const c of schema) {
    const k = tableKey(c);
    let g = map.get(k);
    if (!g) {
      g = { connection: c.connection, schema: c.schema, table: c.table, columns: [] };
      map.set(k, g);
    }
    g.columns.push(c);
  }
  return [...map.values()];
}

/**
 * Render the catalog as a hierarchical ID-tagged blob the agent reads as
 * its userMessage. NO sample rows by design — the agent fetches them via
 * `ExecuteQuery` when it needs a closer look at a specific column.
 *
 * Bounded by `maxChars` with graceful degradation: trailing tables drop
 * when the running total would exceed budget. When degradation kicks in,
 * a `> Note:` block is prepended pointing the agent at the right tools
 * to recover what was dropped.
 */
export function renderCatalogForAgent(
  schema: FlatColumn[],
  idMap: IdMap,
  statsByCol: Map<string, ColumnMeta>,
  rowCountByTable: Map<string, number>,
  maxChars: number = DEFAULT_CATALOG_RENDER_MAX_CHARS,
): string {
  const tables = groupByTable(schema);

  // Build per-table blocks first; greedily pack until the budget would be
  // exceeded. Track which connections/schemas were introduced so we don't
  // duplicate their headers.
  const blocks: string[] = [];
  const seenConnections = new Set<string>();
  const seenSchemas = new Set<string>();
  let total = 0;
  let coveredAll = true;

  for (const t of tables) {
    const lines: string[] = [];
    if (!seenConnections.has(t.connection)) {
      const gId = idMap.byPath(t.connection)?.id ?? '?';
      lines.push(`[${gId}] ${t.connection}`);
      seenConnections.add(t.connection);
    }
    const schemaPath = `${t.connection}.${t.schema}`;
    if (!seenSchemas.has(schemaPath)) {
      const sId = idMap.byPath(schemaPath)?.id ?? '?';
      lines.push(`  [${sId}] ${t.schema}`);
      seenSchemas.add(schemaPath);
    }
    const tPath = `${t.connection}.${t.schema}.${t.table}`;
    const tId = idMap.byPath(tPath)?.id ?? '?';
    const rowCount = rowCountByTable.get(tPath);
    const rowCountSuffix = rowCount !== undefined ? ` (${rowCount} rows)` : '';
    lines.push(`    [${tId}] ${t.table}${rowCountSuffix}`);

    for (const c of t.columns) {
      const cId = idMap.byPath(colKey(c))?.id ?? '?';
      const stats = renderStats(statsByCol.get(colKey(c)));
      const statsSuffix = stats ? `  ${stats}` : '';
      lines.push(`      [${cId}] ${c.column}  ${c.type}${statsSuffix}`);
    }

    const block = lines.join('\n');
    const cost = block.length + (blocks.length > 0 ? 1 : 0); // +1 for separator
    if (total + cost > maxChars) {
      coveredAll = false;
      break;
    }
    blocks.push(block);
    total += cost;
  }

  const body = blocks.join('\n');
  if (coveredAll) return body;

  const dropped = tables.length - blocks.length;
  const note = [
    '> Note: This catalog was bounded to fit the agent\'s context window.',
    `> The summary covers ${blocks.length} of ${tables.length} tables. ${dropped} omitted from the bottom. Use \`SearchDBSchema\` or \`ExecuteQuery\` to inspect any of them.`,
  ].join('\n');
  return `${note}\n\n${body}`;
}

// ─── Slice 3: SubmitSchemaInfo tool ─────────────────────────────────────────

/** Short alphanumeric ID matching `^[gstc][0-9]+$`. */
const ID_PATTERN = '^[gstc][0-9]+$';

const AnnotationSchema = Type.Object({
  id: Type.String({
    pattern: ID_PATTERN,
    description: 'ID of an element (table or column) from the input catalog.',
  }),
  description: Type.Optional(
    Type.String({
      description:
        'Short note — ONLY for unstructured text, JSON blobs, encoded enums, or surprising formats. Include a verbatim example value when describing a format. Skip if name + type + stats already make the element self-evident.',
    }),
  ),
  join: Type.Optional(
    Type.Object({
      to: Type.String({
        pattern: ID_PATTERN,
        description: 'ID of the column this one joins to.',
      }),
    }),
  ),
});

const SubmitSchemaInfoParams = Type.Object({
  annotations: Type.Array(AnnotationSchema, {
    description: 'One entry per element you have something useful to say about. Skip self-evident ones.',
  }),
});

/** Parsed annotation as it arrives from the agent. */
export type Annotation = Static<typeof AnnotationSchema>;

/** Validated structured output from the agent. */
export interface AutoContextPayload {
  annotations: Annotation[];
}

interface SubmitSchemaInfoDetails extends Record<string, unknown> {
  type: 'auto_context';
  payload: AutoContextPayload;
}

const SUBMIT_SCHEMA_INFO_DESCRIPTION = `Submit your annotations for the catalog. Call this exactly once at the end of your turn, with the structured list of:
- Descriptions for elements (tables / columns) whose meaning isn't obvious from name + type + stats. Focus on unstructured text columns, JSON blobs, encoded enums, prefix-laden IDs, and any format with delimiters or quirks. Include a verbatim example value from the data when describing a format.
- Joins between columns you verified via ExecuteQuery probes (COUNT(*) returned ≥ 1 row).

Use the IDs from the catalog input. Do NOT include entries for elements that need no commentary — fewer, higher-signal annotations are better than verbose boilerplate.`;

/** Finisher tool the agent calls exactly once with its structured payload. */
export class SubmitSchemaInfo extends MXTool<
  typeof SubmitSchemaInfoParams,
  BenchmarkAnalystContext,
  SubmitSchemaInfoDetails
> {
  static readonly schema: Tool<typeof SubmitSchemaInfoParams> = {
    name: 'SubmitSchemaInfo',
    description: SUBMIT_SCHEMA_INFO_DESCRIPTION,
    parameters: SubmitSchemaInfoParams,
  };

  async run(): Promise<ToolResponse<SubmitSchemaInfoDetails>> {
    const payload = this.parameters as AutoContextPayload;
    const annCount = payload.annotations.length;
    const joinCount = payload.annotations.filter((a) => a.join).length;
    const descCount = payload.annotations.filter((a) => a.description).length;
    return {
      content: [
        {
          type: 'text',
          text: `AutoContext submitted: ${annCount} annotation(s) — ${descCount} description(s), ${joinCount} join(s).`,
        },
      ],
      details: { type: 'auto_context', payload },
      isError: false,
    };
  }
}

// ─── Slice 4: AutoContextAgent ──────────────────────────────────────────────

const AutoContextAgentParams = Type.Object({
  userMessage: Type.String({
    description:
      "Catalog hierarchy with short IDs at every level. The agent reads this as orientation input and emits annotations via SubmitSchemaInfo.",
  }),
});

const SYSTEM_PROMPT_TEMPLATE = (
  connectionsJson: string,
  contextDocs: string | undefined,
) => `You are AutoContextAgent. Your job: produce orientation notes for a downstream analyst that will answer questions against the database connections shown below.

The analyst already knows: connection names, schemas, table names, column names, column types, and per-column statistics (nDistinct, nullCount, topValues, min/max). Don't restate any of that. Your only job is to add two things the analyst can't infer from name + type + stats alone:

  1. **Descriptions** for elements (columns or tables) where the meaning, encoding, or format isn't obvious.
  2. **Joins** — column-to-column foreign key relationships you verified.

## Input

Your \`userMessage\` is the catalog hierarchy with short IDs at every level:

  [g0] users_db
    [s0] main
      [t0] users (12,345 rows)
        [c0]  id        INTEGER  nDistinct=12345
        [c1]  email     VARCHAR  nDistinct=12340
        [c2]  locations VARCHAR  nDistinct=820  top=["palo alto, san mateo", ...]
  [g1] catalog_db
    ...

Use these IDs in your output. Don't invent IDs.

The data documentation below the connection list (## Data documentation) may describe domain conventions, encodings, or join semantics. **Read it first and let it guide your exploration** — descriptions and join candidates often become obvious from the docs.

## Tools

**ExecuteQuery** — run read-only SQL or Mongo queries against any listed connection. Use it freely. You can issue several queries in parallel by emitting multiple tool calls in one turn — independent probes don't need to be serialized.

  - **Sample inspection.** Before describing a column's format or probing a join, fetch a few rows to see actual values:
        SELECT col FROM t WHERE col IS NOT NULL LIMIT 5

  - **Same-connection join probe.** One query:
        SELECT COUNT(*) FROM <fromTable> a JOIN <toTable> b
        ON a.<fromCol> = b.<toCol> LIMIT 1
    List the join only if the probe returned ≥ 1 row.

  - **Cross-connection join probe.** Use sequential-mode chaining — the second query references the first via \`$label.column\`, which expands to a literal list. Works across any pair of connections:
        queries: [
          { connection: "<src_conn>",
            query: "SELECT DISTINCT <fromCol> FROM <fromTable> LIMIT 200",
            label: "src" },
          { connection: "<dst_conn>",
            query: "SELECT COUNT(*) FROM <dst_table> WHERE <toCol> IN ($src.<fromCol>)" }
        ],
        sequential: true
    List the join only if the count > 0.

  - **Drop a join** if the probe returns 0 rows or errors. The downstream analyst trusts everything you list — phantom joins poison its queries.

Soft probe budget: ~15 ExecuteQuery calls total. Spend them where they change your output.

**SubmitSchemaInfo** — submit your final structured annotations. You're done once this tool call returns successfully. Thinking and prose are fine in between — the agent run continues until SubmitSchemaInfo is invoked.

## How to work

1. Read the catalog and the data documentation.

2. For each table, decide what (if anything) is non-obvious. Fetch a few rows if you want to confirm a hunch about format or encoding.

3. Identify candidate joins. Heuristics:
   - Columns whose name matches another table's column (within the same connection or across connections).
   - \`<entity>_id\` ↔ \`<entity>.id\` patterns.
   - Columns whose top values look like identifiers from another table.
   - Hints in the data documentation.

4. Probe every join you intend to list. Same-connection or cross-connection. Drop joins whose probe doesn't return data.

5. Write descriptions only for elements that need them:
   - **Describe** columns with unstructured text, JSON blobs, encoded enums, prefix-laden IDs, delimited lists, non-ISO date strings, or any format whose structure isn't visible from type + stats.
   - **Describe** a table only when there's something to say beyond its column list — e.g. "one row per trading day", "denormalized join of X and Y for reporting".
   - **Don't describe** elements that are self-evident from name + type + stats. Boilerplate hurts.

6. Every format description must include a verbatim example value, quoted:
   - Good: \`Comma-separated city list, e.g. "palo alto, san mateo"\`
   - Bad:  \`Contains a list of cities\`

7. Self-check before calling SubmitSchemaInfo: drop any join whose probe didn't actually return data; drop any description that just restates name + type. Submit what's genuinely useful.

## Output format

Call SubmitSchemaInfo exactly once with annotations:

  {
    "annotations": [
      { "id": "c2", "description": "Comma-separated city list, e.g. \\"palo alto, san mateo\\"" },
      { "id": "c14", "join": { "to": "c2" } },
      { "id": "t08", "description": "Daily OHLCV bars; one row per trading day, ISO date strings" }
    ]
  }

Rules:
- Every \`id\` and \`join.to\` must be a short alphanumeric ID (^[gstc][0-9]+$) from the catalog input. The tool will reject other shapes.
- An annotation may have \`description\`, \`join\`, both, or neither. Entries with neither are silently dropped.

## Connections available

${connectionsJson}

${contextDocs ? `## Data documentation\n${contextDocs}` : ''}
`;

/**
 * Lighter-model agent that produces structured AutoContext annotations.
 * Dispatched by `BenchmarkAnalystAgent` via `orchestrator.dispatch()`; result
 * cached at the parent layer and reused across rows of the same dataset/slot.
 */
export class AutoContextAgent extends MXAgent<
  typeof AutoContextAgentParams,
  BenchmarkAnalystContext
> {
  static readonly schema: Tool<typeof AutoContextAgentParams> = {
    name: 'AutoContextAgent',
    description:
      'Orientation agent: explores the catalog, verifies joins via ExecuteQuery probes, and submits annotations via SubmitSchemaInfo.',
    parameters: AutoContextAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [
    ChainedExecuteQuery.schema,
    SubmitSchemaInfo.schema,
  ];
  // Re-read on every access so tests / startup hooks that swap the lighter
  // model via `setLighterModel` take effect without re-importing the class.
  static get model() { return getLighterModel(); }
  // Bigger output cap — the structured `SubmitSchemaInfo` call can run >4K
  // tokens for wide-schema datasets where many columns have annotations.
  static readonly callOptions = { maxTokens: 16384 };

  protected override getSystemPrompt(): string {
    const visibleConnections = publicConnectionMetadata(this.context.connections);
    return SYSTEM_PROMPT_TEMPLATE(
      JSON.stringify(visibleConnections),
      this.context.contextDocs,
    );
  }
}

// ─── Slice 5: parseAnnotations + agent-side validation ──────────────────────

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

// ─── Slice 6: verifyJoinsMechanically ───────────────────────────────────────

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

// ─── Slice 7: renderGeneratedContext (merge + Markdown) ─────────────────────

function escapeMd(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Merge the (verified) payload into the canonical catalog and render one
 * Markdown block. This is the final text the analyst sees in
 * `<GeneratedContext>`.
 *
 *   - Each table gets a `## <conn>.<schema>.<table> (N rows) — <tableDesc?>` header.
 *   - Each column is a row in a Markdown table with `col | type | stats |
 *     description | joins` columns, populated from `ColumnMeta` and the
 *     payload annotations indexed by id.
 *   - Verified joins are rendered as `→ <toTable>.<toColumn>`.
 *
 * Returns the full block as a string (no surrounding tag — the caller wraps
 * it in `<GeneratedContext>`).
 */
export function renderGeneratedContext(
  schema: FlatColumn[],
  idMap: IdMap,
  statsByCol: Map<string, ColumnMeta>,
  rowCountByTable: Map<string, number>,
  payload: AutoContextPayload,
): string {
  // Index annotations by id (last write wins on duplicate ids).
  const annById = new Map<string, Annotation>();
  for (const a of payload.annotations) annById.set(a.id, a);

  const tables = groupByTable(schema);
  const sections: string[] = [];

  for (const t of tables) {
    const tablePath = `${t.connection}.${t.schema}.${t.table}`;
    const tableId = idMap.byPath(tablePath)?.id;
    const tableAnn = tableId ? annById.get(tableId) : undefined;
    const rowCount = rowCountByTable.get(tablePath);
    const headerSuffix = rowCount !== undefined ? ` (${rowCount} rows)` : '';
    const headerDesc = tableAnn?.description ? ` — ${tableAnn.description}` : '';
    const lines: string[] = [`## ${tablePath}${headerSuffix}${headerDesc}`, ''];

    lines.push('| col | type | stats | description | joins |');
    lines.push('|---|---|---|---|---|');
    for (const c of t.columns) {
      const cPath = colKey(c);
      const cId = idMap.byPath(cPath)?.id;
      const ann = cId ? annById.get(cId) : undefined;
      const stats = renderStats(statsByCol.get(cPath));
      const desc = ann?.description ? escapeMd(ann.description) : '';
      let joinCell = '';
      if (ann?.join) {
        const target = idMap.byId(ann.join.to);
        if (target && target.table && target.column) {
          joinCell = `→ ${target.table}.${target.column}`;
        }
      }
      lines.push(`| ${c.column} | ${c.type} | ${stats} | ${desc} | ${joinCell} |`);
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

// ─── Slice 8: ensureAutoContext orchestration + cache ───────────────────────

/** Full state the system-prompt renderer needs to reconstruct the rendered
 *  block on every analyst LLM call. Stored on the wrapper's `details`
 *  field — never serialized to the LLM. */
export interface AutoContextWrapperDetails {
  type: 'auto_context_render_state';
  schema: FlatColumn[];
  statsEntries: Array<[string, ColumnMeta]>;
  rowCountEntries: Array<[string, number]>;
  payload: AutoContextPayload;
}

/** What we cache process-wide per `(datasetKey, slot)` after a successful
 *  agent run + verification. Stores the agent's payload + the catalog
 *  snapshot it was built against so cache-hit rows can reconstruct the
 *  same render. */
interface CachedState {
  schema: FlatColumn[];
  statsByCol: Map<string, ColumnMeta>;
  rowCountByTable: Map<string, number>;
  payload: AutoContextPayload;
}

// eslint-disable-next-line no-restricted-syntax -- process-wide cache; race-locked via in-flight Promise pattern
const autoContextStore = new Map<string, Promise<CachedState>>();

export function clearAutoContextCache(): void {
  autoContextStore.clear();
}

/** Synth assistant turn announcing the AutoContextAgent invocation. The
 *  `userMessage` arg carries the rendered catalog for the agent to read. */
function buildSynthAssistant(toolCallId: string, userMessage: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: toolCallId,
      name: AutoContextAgent.schema.name,
      arguments: { userMessage },
    }],
    api: 'controller' as never,
    provider: 'controller',
    model: 'controller',
    usage: EMPTY_USAGE,
    stopReason: 'toolUse',
    timestamp: Date.now(),
  };
}

/** Build the wrapper toolResult that the parent's `toolThread` will carry. */
function buildWrapperToolResult(
  toolCallId: string,
  state: CachedState,
): import('@mariozechner/pi-ai').ToolResultMessage {
  const annCount = state.payload.annotations.length;
  return {
    role: 'toolResult',
    toolCallId,
    toolName: AutoContextAgent.schema.name,
    content: [
      { type: 'text', text: `AutoContext ready — ${annCount} annotation(s) for ${state.schema.length} column(s).` },
    ],
    isError: false,
    details: {
      type: 'auto_context_render_state',
      schema: state.schema,
      statsEntries: [...state.statsByCol.entries()],
      rowCountEntries: [...state.rowCountByTable.entries()],
      payload: state.payload,
    } as AutoContextWrapperDetails,
    timestamp: Date.now(),
  };
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
async function probeJoinUsingConnectors(
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

/**
 * Ensure that `parent.toolThread` has an AutoContextAgent wrapper carrying
 * verified annotations for the current `(datasetKey, slot)`. The wrapper's
 * `details.payload` lets the parent's `getSystemPrompt()` render the
 * `<GeneratedContext>` block on every LLM call.
 *
 * Cache miss: dispatches `AutoContextAgent` via `parent.orchestrator`,
 * parses + verifies its output, caches the result, and pushes the wrapper.
 *
 * Cache hit: skips dispatch and pushes a synthetic wrapper built from the
 * cached state. Either way, the parent's toolThread looks the same after
 * this returns.
 *
 * Race-locked via the in-flight Promise pattern: concurrent rows for the
 * same key share a single dispatch.
 */
export async function ensureAutoContext(parent: MXAgent): Promise<void> {
  const ctx = parent.context as BenchmarkAnalystContext;
  if (!ctx.datasetKey) return; // production paths skip
  const slot = ctx.catalogKey ?? 'default';
  const connections = ctx.connections ?? [];
  if (connections.length === 0) return;

  // `parent.orchestrator` is protected on the MXTool base class but every
  // MXAgent instance has it at runtime — read structurally rather than
  // pass it explicitly to keep the call site `ensureAutoContext(this)`.
  const orchestrator = (parent as unknown as { orchestrator: Orchestrator }).orchestrator;

  // Catalog read (cached at the catalog layer per dataset+slot).
  const catalogCacheKey = `auto-${slot}`;
  const { catalog } = await getCatalogStore(connections, catalogCacheKey, undefined, ctx.datasetKey);
  const { schema, statsByCol, rowCountByTable } = catalogProjection(catalog);
  if (schema.length === 0) return;

  const cacheKey = `${ctx.datasetKey}:${slot}:full`;
  let statePromise = autoContextStore.get(cacheKey);
  if (!statePromise) {
    // MISS — race-lock by inserting the in-flight Promise BEFORE any await
    // beyond this point.
    statePromise = (async (): Promise<CachedState> => {
      const idMap = assignCatalogIds(schema);
      const catalogText = renderCatalogForAgent(schema, idMap, statsByCol, rowCountByTable);

      const dispatchId = gen_id();
      const synth = buildSynthAssistant(dispatchId, catalogText);

      // Dispatch the agent — wrapper lands in parent.toolThread naturally.
      // We splice it back off below; the cached wrapper (built from the
      // verified payload) is what the parent ultimately keeps.
      try {
        await orchestrator.dispatch(synth, parent);
      } finally {
        // Remove the agent's natural-dispatch wrapper from toolThread (we
        // build our own with the right shape below).
        spliceDispatchPair(parent.toolThread, dispatchId);
      }

      const log = orchestrator.log as ConversationLogEntry[];
      const parsed = parseAnnotations(log, dispatchId, idMap);
      if (!parsed) {
        throw new Error('AutoContextAgent did not produce a SubmitSchemaInfo result.');
      }

      // Build connectors once for join probing.
      const connectorsByName = new Map<string, NodeConnector>();
      for (const entry of connections) {
        if (!entry.config) continue;
        const c = await getOrCreateBenchmarkConnector(
          entry.name, entry.dialect, entry.config, { datasetKey: ctx.datasetKey },
        );
        connectorsByName.set(entry.name, c);
      }
      const verified = await verifyJoinsMechanically(
        parsed,
        idMap,
        (from, to) => probeJoinUsingConnectors(connectorsByName, from, to),
      );

      return { schema, statsByCol, rowCountByTable, payload: verified };
    })().catch((err) => {
      autoContextStore.delete(cacheKey);
      throw err;
    });
    autoContextStore.set(cacheKey, statePromise);
  }

  const state = await statePromise;
  // Push the wrapper onto parent.toolThread. We do this uniformly for both
  // cache-hit and cache-miss paths — on miss we already spliced the
  // dispatch's natural wrapper off, on hit dispatch never ran.
  const wrapperId = gen_id();
  parent.toolThread.push(buildSynthAssistant(wrapperId, '<cached AutoContext>'));
  parent.toolThread.push(buildWrapperToolResult(wrapperId, state));
}

/** Splice the (synth assistant, agent-wrapper toolResult) pair for `id` out
 *  of the parent's toolThread. The orchestrator's `log` keeps the
 *  immutable trace; this just trims the runtime state. */
function spliceDispatchPair(arr: import('@mariozechner/pi-ai').Message[], id: string): void {
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr[i];
    if ('role' in m && m.role === 'toolResult' && m.toolCallId === id) {
      arr.splice(i, 1);
      continue;
    }
    if (
      'role' in m && m.role === 'assistant' && Array.isArray(m.content)
      && m.content.some((c) => c.type === 'toolCall' && c.id === id)
    ) {
      arr.splice(i, 1);
    }
  }
}

/**
 * Find the AutoContext wrapper in `parent.toolThread` (pushed by
 * `ensureAutoContext`), reconstruct the catalog snapshot from its
 * `details`, and render the `<GeneratedContext>` Markdown block. Returns
 * `undefined` when no wrapper is present (e.g. `ensureAutoContext` didn't
 * fire on this row — production paths, build failures, etc.).
 *
 * `BenchmarkAnalystAgent.getSystemPrompt()` calls this every LLM iteration.
 * It's pure / deterministic; the render is rebuilt each call, but the
 * per-call cost is negligible (sub-millisecond for typical schemas).
 */
export function renderGeneratedContextFromToolThread(parent: MXAgent): string | undefined {
  const wrapper = parent.toolThread.find(
    (m) =>
      'role' in m &&
      m.role === 'toolResult' &&
      m.toolName === AutoContextAgent.schema.name,
  ) as import('@mariozechner/pi-ai').ToolResultMessage | undefined;
  if (!wrapper) return undefined;
  const details = wrapper.details as AutoContextWrapperDetails | undefined;
  if (!details || details.type !== 'auto_context_render_state') return undefined;
  const { schema, statsEntries, rowCountEntries, payload } = details;
  if (!schema || schema.length === 0) return undefined;
  const idMap = assignCatalogIds(schema);
  return renderGeneratedContext(
    schema,
    idMap,
    new Map(statsEntries),
    new Map(rowCountEntries),
    payload,
  );
}
