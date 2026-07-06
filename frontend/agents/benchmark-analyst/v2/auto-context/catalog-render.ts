/**
 * AutoContext — catalog ID assignment + catalog-for-agent rendering.
 *
 * Phase 1 of the AutoContext pipeline (see `auto-context.ts` for the
 * overview): walk the flattened catalog projection, assign short
 * deterministic IDs to every connection/schema/table/column, and render
 * the ID-tagged hierarchy the `AutoContextAgent` reads as its `userMessage`.
 *
 * `TableGroup` / `groupByTable` / `renderStats` / `packBlocksWithNote` are
 * shared with `generation.ts`'s `renderGeneratedContext` — both renderers
 * walk the same table/column shape and use the same graceful-degradation
 * strategy (shed stat detail, then drop trailing tables) when the output
 * would overflow the target model's context window.
 */
import 'server-only';

import type { ColumnMeta } from '@/lib/connections/base';
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

// ─── renderCatalogForAgent ───────────────────────────────────────────────────

/** Soft cap on the rendered catalog the agent receives as `userMessage`.
 *  Picked to leave room for the agent's system prompt + tool descriptions +
 *  response space under typical lighter-model context windows. */
export const DEFAULT_CATALOG_RENDER_MAX_CHARS = 80_000;

/** Canonical dotted path for a column — shared key shape with `generation.ts`'s
 *  annotation resolution (`resolveColumns` looks up the same key via `IdMap`). */
export function colKey(c: FlatColumn): string {
  return `${c.connection}.${c.schema}.${c.table}.${c.column}`;
}
function tableKey(t: { connection: string; schema: string; table: string }): string {
  return `${t.connection}.${t.schema}.${t.table}`;
}

/** How much per-column stat detail to emit. Used by the graded-degradation
 *  renderers to shed the most expensive bits (top values) before the rest. */
type StatsDetail = 'full' | 'no-top' | 'none';

export function renderStats(meta: ColumnMeta | undefined, detail: StatsDetail = 'full'): string {
  if (!meta || detail === 'none') return '';
  const bits: string[] = [];
  if (meta.nDistinct !== undefined) bits.push(`nDistinct=${meta.nDistinct}`);
  if (meta.nullCount !== undefined && meta.nullCount > 0) bits.push(`nullCount=${meta.nullCount}`);
  if (meta.min !== undefined && meta.max !== undefined) bits.push(`min=${meta.min} max=${meta.max}`);
  if (detail === 'full' && meta.topValues && meta.topValues.length > 0) {
    const top = meta.topValues.slice(0, 3).map((t) => JSON.stringify(t.value)).join(', ');
    bits.push(`top=[${top}]`);
  }
  return bits.join(' ');
}

/**
 * Greedily keep leading table blocks until the next would push past
 * `maxChars`, then prepend a recovery note naming how many tables were
 * dropped. Shared last-resort tier for both the catalog (agent input) and
 * generated-context (analyst output) renderers, used only when even the
 * leanest full render overflows. Always keeps at least the first block so
 * the output is never empty. `sep` is the join string between blocks.
 */
export function packBlocksWithNote(
  blocks: string[],
  totalTables: number,
  maxChars: number,
  sep: string,
  buildNote: (kept: number, total: number) => string,
): string {
  const kept: string[] = [];
  let total = 0;
  for (const block of blocks) {
    const cost = block.length + (kept.length > 0 ? sep.length : 0);
    if (total + cost > maxChars) break;
    kept.push(block);
    total += cost;
  }
  if (kept.length === 0 && blocks.length > 0) kept.push(blocks[0]);
  const body = kept.join(sep);
  if (kept.length >= totalTables) return body;
  return `${buildNote(kept.length, totalTables)}\n\n${body}`;
}

export interface TableGroup {
  connection: string;
  schema: string;
  table: string;
  columns: FlatColumn[];
}

export function groupByTable(schema: FlatColumn[]): TableGroup[] {
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

/** One ID-tagged block per table (connection/schema headers emitted once,
 *  on their first occurrence). `detail` controls per-column stat verbosity. */
function buildCatalogBlocks(
  tables: TableGroup[],
  idMap: IdMap,
  statsByCol: Map<string, ColumnMeta>,
  rowCountByTable: Map<string, number>,
  detail: StatsDetail,
): string[] {
  const blocks: string[] = [];
  const seenConnections = new Set<string>();
  const seenSchemas = new Set<string>();

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
      const stats = renderStats(statsByCol.get(colKey(c)), detail);
      const statsSuffix = stats ? `  ${stats}` : '';
      lines.push(`      [${cId}] ${c.column}  ${c.type}${statsSuffix}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks;
}

const catalogBoundedNote = (kept: number, total: number): string => [
  '> Note: This catalog was bounded to fit the agent\'s context window.',
  `> The summary covers ${kept} of ${total} tables. ${total - kept} omitted from the bottom. Use \`SearchDBSchema\` or \`ExecuteQuery\` to inspect any of them.`,
].join('\n');

/**
 * Render the catalog as a hierarchical ID-tagged blob the agent reads as
 * its userMessage. NO sample rows by design — the agent fetches them via
 * `ExecuteQuery` when it needs a closer look at a specific column.
 *
 * Graded degradation, coverage-first: the agent must SEE every table to
 * annotate the whole schema, so when the full render overflows `maxChars`
 * we shed stat detail globally (top values → all stats) before dropping
 * any table. Only when the bare name+type skeleton of every table still
 * overflows do we drop trailing tables and prepend a `> Note:` pointing the
 * agent at the tools that recover them.
 */
export function renderCatalogForAgent(
  schema: FlatColumn[],
  idMap: IdMap,
  statsByCol: Map<string, ColumnMeta>,
  rowCountByTable: Map<string, number>,
  maxChars: number = DEFAULT_CATALOG_RENDER_MAX_CHARS,
): string {
  const tables = groupByTable(schema);

  for (const detail of ['full', 'no-top', 'none'] as const) {
    const body = buildCatalogBlocks(tables, idMap, statsByCol, rowCountByTable, detail).join('\n');
    if (body.length <= maxChars) return body;
  }

  // Even the bare skeleton overflows — drop trailing tables, note the rest.
  const skeleton = buildCatalogBlocks(tables, idMap, statsByCol, rowCountByTable, 'none');
  return packBlocksWithNote(skeleton, tables.length, maxChars, '\n', catalogBoundedNote);
}
