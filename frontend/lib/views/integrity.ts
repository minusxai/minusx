/**
 * View integrity — the security boundary and the dependency graph, which turn
 * out to be the same mechanism.
 *
 * THE RULE. A view may read anything the DEFINING context's PARENT offers it
 * (`parentSchema`) — so it can curate a safe aggregate of a table this context
 * deliberately hides from its users — and not one table more, so a child admin
 * can never punch through the whitelist chain the org set above them. At the
 * root, the parent offers everything: the root admin has full authority.
 *
 * HOW IT STAYS CHEAP. Each view's dependency list (`reads`) is computed from its
 * SQL once, at the context-SAVE boundary (never trusted from the client — the
 * view dialog, the raw JSON editor and the agent's EditFile all pass through the
 * same gate). Every later check is then a pure set comparison, no parsing:
 *   · security   — reads.tables ⊆ what the parent offers
 *   · integrity  — reads.views ⊆ views visible here
 *   · impact     — the same edges, read backwards (who breaks if I delete this?)
 *
 * WHY THIS IS RECURSIVE. Every context validates only its OWN views. An
 * ancestor's views were already validated against ITS parent when its loader
 * ran, so if each level enforces locally and refuses to pass on what's broken,
 * the whole tree is guaranteed — with no global crawl.
 *
 * A later parent narrowing therefore DISABLES the dependent view (loudly, with a
 * reason) instead of silently escalating it.
 */

import { parseSqlToIrLocal } from '@/lib/sql/sql-to-ir';
import { isCompoundQueryIR } from '@/lib/sql/ir-types';
import { VIEWS_SCHEMA } from '@/lib/types/views';
import type { AnyQueryIR, QueryIR, TableReference } from '@/lib/sql/ir-types';
import type { DatabaseWithSchema, ViewDef, ViewReads } from '@/lib/types';

const tableRefs = (ir: QueryIR): TableReference[] =>
  [ir.from, ...(ir.joins ?? []).map((j) => j.table)].filter(Boolean) as TableReference[];

const isViewRef = (t: TableReference): boolean => (t.schema ?? '').toLowerCase() === VIEWS_SCHEMA;

/**
 * What a SQL statement reads: real tables and views, including through the
 * author's own CTEs (whose bodies the IR stores as raw SQL — a table hidden
 * inside a `WITH` must never escape the check).
 */
export async function computeViewReads(sql: string, dialect: string): Promise<ViewReads> {
  const tables = new Map<string, { schema?: string; table: string }>();
  const views = new Set<string>();

  const walk = async (statement: string): Promise<void> => {
    const ir: AnyQueryIR = await parseSqlToIrLocal(statement, dialect);
    const queries = isCompoundQueryIR(ir) ? ir.queries : [ir];
    for (const q of queries) {
      const cteNames = new Set((q.ctes ?? []).map((c) => c.name.toLowerCase()));
      for (const ref of tableRefs(q)) {
        if (isViewRef(ref)) {
          views.add(ref.table);
        } else if (!ref.schema && cteNames.has(ref.table.toLowerCase())) {
          // a reference to the query's own CTE, not a real table
        } else {
          tables.set(`${ref.schema ?? ''}.${ref.table}`, { ...(ref.schema ? { schema: ref.schema } : {}), table: ref.table });
        }
      }
      for (const cte of q.ctes ?? []) await walk(cte.raw_sql);
    }
  };

  await walk(sql);
  return { tables: [...tables.values()], views: [...views] };
}

/** Index of what a connection's schema offers: "schema.table" keys. */
function offeredTables(offered: DatabaseWithSchema[], connection: string): Set<string> {
  const keys = new Set<string>();
  for (const db of offered) {
    if (db.databaseName !== connection) continue;
    for (const s of db.schemas ?? []) {
      for (const t of s.tables ?? []) keys.add(`${s.schema}.${t.table}`.toLowerCase());
    }
  }
  return keys;
}

/**
 * Is this view usable here? Returns null when fine, else the human reason it is
 * DISABLED (a table the parent no longer offers, or a view that has vanished).
 *
 * @param offered   what the DEFINING context's parent exposes (its parentSchema)
 * @param visible   the other views visible to the defining context
 */
export function checkViewAvailability(
  view: ViewDef,
  offered: DatabaseWithSchema[],
  visible: ViewDef[],
): string | null {
  const reads = view.reads;
  if (!reads) return null; // never computed (legacy) — nothing to check against

  const allowed = offeredTables(offered, view.connection);

  // If we don't KNOW what the connection offers (schema never introspected, or
  // introspection is failing right now), we cannot judge — and must not pretend
  // to. Disabling every view on a transient introspection failure would be far
  // worse than the theoretical exposure: this is an availability gap, not a
  // policy decision. The save-time gate still runs whenever a schema IS known.
  if (allowed.size === 0) return checkViewDeps(view, visible);

  const missing = reads.tables.filter((t) => !allowed.has(`${t.schema ?? ''}.${t.table}`.toLowerCase()));
  if (missing.length > 0) {
    const names = missing.map((t) => (t.schema ? `${t.schema}.${t.table}` : t.table)).join(', ');
    return `reads ${names}, which is not offered by the parent knowledge base`;
  }

  return checkViewDeps(view, visible);
}

/** The view-to-view half of the check: every view it reads must still be here. */
function checkViewDeps(view: ViewDef, visible: ViewDef[]): string | null {
  const reads = view.reads;
  if (!reads) return null;
  const visibleNames = new Set(visible.filter((v) => v.connection === view.connection).map((v) => v.name));
  const missingViews = reads.views.filter((n) => n !== view.name && !visibleNames.has(n));
  if (missingViews.length > 0) {
    return `reads ${missingViews.map((n) => `${VIEWS_SCHEMA}.${n}`).join(', ')}, which no longer exists`;
  }
  return null;
}

/**
 * Every view that would break if `name` went away — direct and TRANSITIVE.
 * This is what makes "delete" and "rename" safe: we can name the casualties
 * before the damage, instead of discovering them through a failed query.
 */
export function findViewDependents(name: string, all: ViewDef[]): string[] {
  const dependents = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const v of all) {
      if (v.name === name || dependents.has(v.name)) continue;
      const reads = v.reads?.views ?? [];
      if (reads.some((r) => r === name || dependents.has(r))) {
        dependents.add(v.name);
        grew = true;
      }
    }
  }
  return [...dependents];
}
