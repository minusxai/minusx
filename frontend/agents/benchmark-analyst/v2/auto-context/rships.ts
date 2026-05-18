import 'server-only';

import type { ColumnMeta } from '@/lib/connections/base';
import type { RunPromptPassOpts, PromptPassContext } from '../prompt-pass';
import type { FlatColumn } from './schema';
import type { JoinForNote, TableNoteInput, TableNoteOutput } from './notes';
import type { Example, GenerateExamplesOpts } from './examples';
import type { AnnotatedTable, AnnotatedColumn } from './format';
import { discoverJoins, type FetchSampleValues, type JoinFinding } from './joins';

const DEFAULT_MAX_CHARS = 100_000;

/** Result of one AutoContext build — the data the formatter needs. */
export interface RshipsNStructureResult {
  tables: AnnotatedTable[];
  examples: Example[];
}

/** Dependencies injected by the higher-level entry point (index.ts). Kept
 *  as callbacks so this module can be tested without a live DB or LLM. */
export interface RshipsDeps {
  /** For join-overlap probes — return up to ~200 distinct values for one column. */
  fetchSampleValues: FetchSampleValues;
  /** Per-table sample rows; used for LLM notes prompting. */
  fetchTableSample: (table: { connection: string; schema: string; table: string }) => Promise<Record<string, unknown>[]>;
  /** LLM call: writes per-table + per-column notes. */
  generateTableNotes: (input: TableNoteInput, opts: RunPromptPassOpts) => Promise<TableNoteOutput>;
  /** LLM call: proposes execution-validated example queries demonstrating
   *  the verified findings. */
  generateExamples: (
    schemaSummary: string,
    findings: Array<{ description: string; connection: string }>,
    opts: GenerateExamplesOpts,
  ) => Promise<Example[]>;
  /** LLM call: when the schema is too big for the maxChars budget, pick
   *  the table identifiers most relevant to the user's question. Returns
   *  the set of allowed `<connection>.<schema>.<table>` identifiers. */
  filterSchemaByQuestion: (
    schema: FlatColumn[],
    userMessage: string,
    llmContext: PromptPassContext,
  ) => Promise<Set<string>>;
}

export interface GetRshipsNStructureOpts {
  datasetKey: string;
  /** Per-slot discriminator (DoubleCheck sets this to 'agent-a' /
   *  'agent-b' for primary + secondary). Mixed into the cache key so
   *  primary + secondary sub-agents get isolated cache slots. Defaults
   *  to 'default' when not provided. */
  cacheKey?: string;
  /** The user's current question. Required to drive the filter step when
   *  the schema doesn't fit. Omitting it forces the unfiltered path. */
  userMessage?: string;
  /** Grounding context passed to LLM sub-prompts (forwarded to notes +
   *  examples + filter). Note: `originalMessage` is automatically
   *  stripped from notes/examples calls in the unfiltered branch — see
   *  the cache-safety invariant below. */
  llmContext: PromptPassContext;
  /** Char budget that decides filter-vs-full. Default 100,000. */
  maxChars?: number;
}

/**
 * Estimate how many characters the SCHEMA-ONLY render would consume.
 * Used to decide whether to filter on the user question. Cheap, pure.
 */
export function estimateSchemaChars(schema: FlatColumn[]): number {
  // ~`db.public.users.column_name (VARCHAR)\n` per row → roughly 50 chars each.
  // Empirically a touch larger when types are long; the multiplier is a
  // safe upper bound, not a tight one.
  return schema.reduce((sum, c) =>
    sum +
    c.connection.length + c.schema.length + c.table.length +
    c.column.length + c.type.length + 8 /* punctuation + newline */,
    0,
  );
}

function tableId(c: { connection: string; schema: string; table: string }): string {
  return `${c.connection}.${c.schema}.${c.table}`;
}

function colKey(c: FlatColumn): string {
  return `${c.connection}.${c.schema}.${c.table}.${c.column}`;
}

/** Build a `JoinForNote` view of every join touching the given table.
 *  Edges are oriented so `fromColumn` lives on `table`. */
function joinsForTable(
  findings: JoinFinding[],
  table: { connection: string; schema: string; table: string },
): JoinForNote[] {
  const out: JoinForNote[] = [];
  for (const f of findings) {
    if (tableId(f.left) === tableId(table)) {
      out.push({
        fromColumn: f.left.column,
        toTable: f.right.table,
        toColumn: f.right.column,
        kind: f.kind,
        overlap: f.overlap,
      });
    } else if (tableId(f.right) === tableId(table)) {
      out.push({
        fromColumn: f.right.column,
        toTable: f.left.table,
        toColumn: f.left.column,
        kind: f.kind,
        overlap: f.overlap,
      });
    }
  }
  return out;
}

/** A compact textual summary of the (annotated) schema for the examples
 *  prompt. Pure — examples step doesn't need samples/joins separately. */
function buildSchemaSummary(tables: AnnotatedTable[]): string {
  return tables
    .map((t) => {
      const cols = t.columns.map((c) => `${c.name} ${c.type}`).join(', ');
      return `${tableId(t)}: ${cols}`;
    })
    .join('\n');
}

// ─── Caching ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-restricted-syntax -- server-only; benchmark process singleton, key is (datasetKey + filter fingerprint)
const rshipsStore = new Map<string, Promise<RshipsNStructureResult>>();

export function clearRshipsCache(): void {
  rshipsStore.clear();
}

/** Stable string key from a list of identifiers — order-independent. */
function fingerprint(ids: Iterable<string>): string {
  return [...new Set(ids)].sort().join('|');
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Top-level AutoContext build, fully dependency-injected. The unfiltered
 * branch (schema fits the budget) is cached per `datasetKey` and shared
 * across all questions in that dataset, so LLM sub-prompts MUST NOT see
 * `originalMessage` (would bias the cached output toward the first
 * question). The filtered branch (`fingerprint(allowed_table_ids)` in
 * the key) is allowed to use `originalMessage` since the cache slot
 * itself reflects which question's filter produced it.
 */
export async function getRshipsNStructure(
  schema: FlatColumn[],
  statsByCol: Map<string, ColumnMeta>,
  rowCountByTable: Map<string, number>,
  dialectsByConn: Map<string, string>,
  deps: RshipsDeps,
  opts: GetRshipsNStructureOpts,
): Promise<RshipsNStructureResult> {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const slot = opts.cacheKey ?? 'default';

  // 1) Filter decision (schema-only estimate).
  const needsFilter = estimateSchemaChars(schema) > maxChars;
  let effectiveSchema = schema;
  let cacheKey: string;
  let skipUserMessage: boolean;

  if (needsFilter && opts.userMessage) {
    const allowed = await deps.filterSchemaByQuestion(schema, opts.userMessage, opts.llmContext);
    effectiveSchema = schema.filter((c) => allowed.has(tableId(c)));
    cacheKey = `${opts.datasetKey}:${slot}:f:${fingerprint(allowed)}`;
    skipUserMessage = false; // filtered branch — cache reflects the question
  } else {
    // Unfiltered (either schema fits, or no userMessage to drive a filter).
    cacheKey = `${opts.datasetKey}:${slot}:full`;
    skipUserMessage = true; // unfiltered branch — cache is question-agnostic
  }

  // 2) In-flight + persistent cache, race-locked.
  const existing = rshipsStore.get(cacheKey);
  if (existing) return existing;

  const built = (async () => {
    // Group columns by table.
    const byTable = new Map<string, { connection: string; schema: string; table: string; cols: FlatColumn[] }>();
    for (const c of effectiveSchema) {
      const id = tableId(c);
      let entry = byTable.get(id);
      if (!entry) {
        entry = { connection: c.connection, schema: c.schema, table: c.table, cols: [] };
        byTable.set(id, entry);
      }
      entry.cols.push(c);
    }

    // 3) Sample rows + join discovery in parallel.
    const sampleByTable = new Map<string, Record<string, unknown>[]>();
    await Promise.all(
      [...byTable.values()].map(async (t) => {
        sampleByTable.set(tableId(t), await deps.fetchTableSample(t));
      }),
    );

    const findings = await discoverJoins(effectiveSchema, statsByCol, deps.fetchSampleValues);

    // 4) Per-table notes (one LLM call each, run in parallel).
    const noteOpts: RunPromptPassOpts = { skipUserMessage };
    const tables: AnnotatedTable[] = await Promise.all(
      [...byTable.values()].map(async (t) => {
        const samples = sampleByTable.get(tableId(t)) ?? [];
        const joinsToTable = joinsForTable(findings, t);
        const noteInput: TableNoteInput = {
          connection: t.connection,
          schema: t.schema,
          table: t.table,
          columns: t.cols.map((c) => ({
            name: c.column,
            type: c.type,
            meta: statsByCol.get(colKey(c)),
          })),
          samples,
          joinsToTable,
        };
        const notes = await deps.generateTableNotes(noteInput, noteOpts);

        const annotatedCols: AnnotatedColumn[] = t.cols.map((c) => ({
          name: c.column,
          type: c.type,
          meta: statsByCol.get(colKey(c)),
          note: notes.columns.find((n) => n.name === c.column)?.note ?? '',
        }));

        return {
          connection: t.connection,
          schema: t.schema,
          table: t.table,
          rowCount: rowCountByTable.get(tableId(t)),
          tableNote: notes.table_note,
          columns: annotatedCols,
          joins: joinsToTable,
          samples,
        };
      }),
    );

    // 5) Examples — one LLM call total, then execution-validation by the
    //    dep's underlying executor. Each finding maps to one demonstration.
    const findingSeeds = findings.map((f) => ({
      description: `Verified join: ${tableId(f.left)}.${f.left.column} ↔ ${tableId(f.right)}.${f.right.column} (${f.kind}, overlap=${f.overlap.toFixed(2)})`,
      connection: f.left.connection,
    }));
    const summary = buildSchemaSummary(tables);
    const examples = await deps.generateExamples(summary, findingSeeds, {
      skipUserMessage,
    });

    // Silence unused-var lint when dialects map isn't consumed downstream
    // (it'll be threaded into examples generation by index.ts).
    void dialectsByConn;

    return { tables, examples };
  })().catch((err) => {
    rshipsStore.delete(cacheKey);
    throw err;
  });

  rshipsStore.set(cacheKey, built);
  return built;
}
