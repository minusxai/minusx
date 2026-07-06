/**
 * Annotation-notes budgeting.
 *
 * Renders context-authored table/column descriptions (`TableAnnotation[]`)
 * into the "Schema Notes" markdown section within a character budget, and
 * backfills legacy annotations that lack a `connection`. Consumed by
 * `lib/sql/context-docs.ts` when it builds a context's Schema Notes.
 */
import { DatabaseWithSchema, TableAnnotation } from '../types';
import { CONTEXT_BUDGETS } from '../context/context-budgets';

/**
 * Default character budget for the context-authored "Tables & Columns"
 * description block in Schema Notes. Sourced from the central context-budget
 * dashboard (`lib/context/context-budgets.ts`).
 */
const DEFAULT_SCHEMA_NOTES_BUDGET_CHARS = CONTEXT_BUDGETS.schemaNotesChars;

/**
 * Greedily renders context-authored table/column descriptions into markdown
 * bullet lines, capped at `budgetChars`. Each annotated table (its head line +
 * any annotated column sub-lines) is an indivisible block: included whole or
 * dropped whole. Tables with neither a description nor any annotated columns
 * produce nothing and are never counted as dropped. Returns the kept lines plus
 * how many annotated tables/columns were omitted, for a truncation note.
 */
export function budgetAnnotationNotes(
  annotations: TableAnnotation[],
  budgetChars: number = DEFAULT_SCHEMA_NOTES_BUDGET_CHARS,
): { lines: string[]; droppedTables: number; droppedColumns: number } {
  const lines: string[] = [];
  let used = 0;
  let truncated = false;
  let droppedTables = 0;
  let droppedColumns = 0;

  for (const a of annotations) {
    const cols = (a.columns || []).filter((c) => c.description);
    if (!a.description && cols.length === 0) continue; // nothing to say — not a drop
    const conn = a.connection ? `[${a.connection}] ` : '';
    const head = `- ${conn}${a.schema}.${a.table}${a.description ? ` — ${a.description}` : ''}`;
    const block = [head, ...cols.map((c) => `  - ${c.name}: ${c.description}`)];
    const cost = block.reduce((n, l) => n + l.length + 1, 0); // +1 ≈ newline per line
    if (!truncated && used + cost <= budgetChars) {
      lines.push(...block);
      used += cost;
    } else {
      truncated = true;
      droppedTables++;
      droppedColumns += cols.length;
    }
  }

  return { lines, droppedTables, droppedColumns };
}

/**
 * Backfill a `connection` onto annotations that lack one (legacy entries saved
 * before the editor stamped it), by matching `schema.table` against the
 * context's available schema. Only fills when the match is UNAMBIGUOUS — exactly
 * one connection owns that `schema.table` — so we never mislabel a table that
 * exists in two connections. Annotations that already have a connection, or that
 * match zero/multiple connections, pass through untouched.
 */
export function backfillAnnotationConnections(
  annotations: TableAnnotation[],
  fullSchema: DatabaseWithSchema[] | undefined,
): TableAnnotation[] {
  if (!fullSchema || fullSchema.length === 0) return annotations;
  const owners = new Map<string, Set<string>>(); // [schema, table] key → connections
  for (const db of fullSchema) {
    for (const s of db.schemas) {
      for (const t of s.tables) {
        const key = JSON.stringify([s.schema, t.table]);
        (owners.get(key) ?? owners.set(key, new Set()).get(key)!).add(db.databaseName);
      }
    }
  }
  return annotations.map((a) => {
    if (a.connection) return a;
    const set = owners.get(JSON.stringify([a.schema, a.table]));
    return set && set.size === 1 ? { ...a, connection: [...set][0] } : a;
  });
}
