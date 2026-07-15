// ============================================================================
// Views — curated SQL exposed as ordinary tables.
//
// A view is SQL, defined on a context version (versioned + inherited exactly
// like metrics/relationships), that the rest of the app treats as a TABLE: it
// appears in the schema tree under the `_views` schema, derives a semantic
// model from its output columns, can carry metrics and relationships, and is
// visible to the agent.
//
// Views are VIRTUAL: nothing is created in the warehouse (most production
// connections are read-only). At execution time a query that reads
// `_views.<name>` is rewritten in IR land to inline the view's SQL as a CTE
// (lib/views/resolve.ts).
//
// Naming: a single FLAT `_views` schema per connection — the schema name ends
// up inside user SQL and inside saved questions, so it must be a stable
// identifier that survives folder moves (and self-describing, not branded).
// Scoping comes from the context hierarchy (a child sees its own + inherited
// views), not from decorating the name with a path. Names are unique across the
// whole inherited chain — no shadowing (two people running "revenue" must never
// get different numbers).
// ============================================================================

import type { VizSettings } from '@/lib/validation/atlas-schemas';

/** The virtual schema every view lives in. */
export const VIEWS_SCHEMA = '_views';

/** A view's output column, snapshotted at save (types drive semantic derivation). */
export interface ViewColumn {
  name: string;
  type: string;
}

/**
 * A view is INLINE SQL. ("Promote to view" copies a question's SQL in — the
 * question is a starting point, not a live dependency. A live link would let the
 * question's SQL change after the view was authorized, silently escalating what
 * the view can read, so it would demand a re-check on every query.)
 */
export interface ViewDef {
  /** Identifier used in SQL: `_views.<name>`. Unique across the inherited chain. */
  name: string;
  /** Views are scoped to one connection — their SQL runs on one engine. */
  connection: string;
  /** The view's SQL. May itself read other views (resolved recursively). */
  sql: string;
  /**
   * What this view reads — computed from the SQL at the context-save boundary
   * (never trusted from the client). Makes every downstream check a cheap SET
   * COMPARISON instead of a parse:
   *  · security — `tables` must stay within what the DEFINING context's parent
   *    offers, so a view can never punch through the whitelist chain, and a later
   *    parent narrowing disables it rather than silently escalating;
   *  · integrity — `views` tells us who breaks if a view is deleted or renamed;
   *  · impact analysis and the "disabled" badges, read backwards.
   */
  reads?: ViewReads;
  /** Output columns, captured at save. Absent until first successful save. */
  columns?: ViewColumn[];
  /**
   * Columns exposed downstream. Absent = all of them. A view's CTE is projected
   * to exactly these, so a deselected column genuinely ceases to exist for the
   * agent, the GUI and any query — unlike hiding a raw table's column, this is
   * real enforcement, not just concealment.
   */
  whitelistedColumns?: string[];
  /** The chart the view was authored with (restored when the view is reopened). */
  vizSettings?: VizSettings;
  description?: string;
}

/** What a view reads. Computed server-side from its SQL; never client-supplied. */
export interface ViewReads {
  tables: Array<{ schema?: string; table: string }>;
  views: string[];
}

/** Why a view is currently unusable (computed at load; see ViewReads). */
export interface ViewProblem {
  view: string;
  reason: string;
}

/** The effective column list a view exposes (whitelist applied). */
export function exposedColumns(v: ViewDef): ViewColumn[] {
  const all = v.columns ?? [];
  if (!v.whitelistedColumns) return all;
  const allowed = new Set(v.whitelistedColumns);
  return all.filter((c) => allowed.has(c.name));
}
