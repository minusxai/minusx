/**
 * The schema, as data.
 *
 * `postgres-schema.ts` describes the database as a block of SQL text. That works for
 * one deployment shape and nothing else: anything that needs a *variant* of the schema
 * has to restate every table, and the two copies then drift — silently, because
 * `IF NOT EXISTS` matches on name rather than definition.
 *
 * Declaring tables as typed data instead makes a variant a `.map()` over the
 * declaration. The types below are deliberately narrow: they express exactly what the
 * real schema uses and nothing more.
 *
 * **There is no raw-SQL escape hatch, by design.** Anything held as opaque SQL is
 * invisible to consumers of this model — they cannot rewrite it, and an equivalence
 * test cannot tell whether they should have. If something here cannot be expressed,
 * the fix is to widen the type, not to smuggle a string through.
 */

/** Every column type the schema uses. Widen deliberately, not casually. */
export type ColumnType =
  | 'TEXT'
  | 'VARCHAR'
  | `VARCHAR(${number})`
  | 'SMALLINT'
  | 'INTEGER'
  | 'BIGINT'
  | 'FLOAT8'
  | 'BOOLEAN'
  | 'UUID'
  | 'JSONB'
  | 'TIMESTAMP'
  | 'TIMESTAMPTZ'
  | 'SERIAL'
  | 'BIGSERIAL';

export interface Column {
  name: string;
  type: ColumnType;
  notNull?: boolean;
  /** Rendered verbatim after DEFAULT — a SQL expression, not a JS value. */
  default?: string;
  /** Rendered as CHECK (...) inline on the column. */
  check?: string;
}

/**
 * How widely a value must be unique.
 *
 * A variant that adds a scoping column prepends it to `scoped` uniqueness but must
 * leave `global` alone — otherwise a genuinely global invariant is silently weakened.
 * Stating it here means no consumer has to guess.
 */
export type UniquenessScope = 'scoped' | 'global';

export interface Unique {
  columns: readonly string[];
  scope: UniquenessScope;
}

export interface Index {
  name: string;
  columns: readonly IndexColumn[];
  unique?: boolean;
  /**
   * Whether a UNIQUE index holds within a namespace or across the whole deployment.
   * Same meaning as `Unique.scope`, and only meaningful when `unique` is set — a
   * variant that scopes indexes must leave a `global` one alone or it silently weakens
   * the invariant. Defaults to `scoped`.
   */
  scope?: UniquenessScope;
  /** Partial-index predicate, rendered after WHERE. */
  where?: string;
  /** Index access method. Omitted means the default (btree). */
  using?: 'gin';
  /** Operator class, e.g. `jsonb_path_ops`. Only meaningful with `using`. */
  opclass?: string;
}

/**
 * A column reference in an index. Expression indexes are first-class rather than an
 * escape hatch: the one in the real schema (`(meta -> 'shares') jsonb_path_ops`) is
 * exactly the kind of thing that falls out of a model and then ships unscoped.
 */
export type IndexColumn =
  | string
  | { column: string; direction: 'DESC' }
  | { expression: string };

/**
 * Where a table's rows live.
 *
 * `shared` — one set of rows for the whole deployment.
 * `per-namespace` — rows belong to a namespace, and only that namespace can see them.
 * `public` — rows belong to a namespace, but ANY namespace may read them.
 *
 * `public` exists for the questions that must be answered before the namespace is
 * known: which namespace owns a given third-party workspace, what data version each is
 * on. Every other table is unreadable at that point, since a namespace-scoped policy has
 * nothing to compare against yet. Writes stay scoped — only reads cross the boundary.
 *
 * The cost is the contract: anything stored in a `public` table is readable by every
 * namespace, so nothing namespace-private may go there. That is a rule about content,
 * which the type cannot enforce — it has to be held deliberately.
 *
 * Declared here rather than as a name list held by the consumer: a list rots the day
 * a table is added, and it fails open.
 */
export type TableScope = 'shared' | 'per-namespace' | 'public';

export interface Table {
  name: string;
  scope: TableScope;
  columns: readonly Column[];
  /**
   * Always rendered as a table-level constraint so it is auto-named `<table>_pkey`.
   * Upserts target that name rather than a column list, which is what lets one
   * statement work against a variant that adds scoping columns — so the name must
   * never be set explicitly.
   */
  primaryKey: readonly string[];
  uniques?: readonly Unique[];
  indexes?: readonly Index[];
  /**
   * Maintain `updated_at` on UPDATE via a BEFORE trigger. The four in the real schema
   * have identical bodies, so they are a flag rather than four function definitions.
   */
  touchUpdatedAt?: boolean;
}

export type Schema = readonly Table[];
