/**
 * Derived semantic models — the semantic layer WITHOUT authored model config.
 *
 * A SemanticModel is pure vocabulary: which columns group (dimensions), which
 * aggregate (measures), which column is the time axis, and which equi-joins are
 * safe lookups. All of that except joins is derivable from the whitelisted
 * schema + profiled column metadata (`ColumnMeta.category`), so models are
 * DERIVED on demand — one model per whitelisted table — and the only authored
 * input is the table's declared FK relationships (`TableRelationship`, edited
 * in the whitelist UI).
 *
 * Models are deliberately NOT stored on the context content: a large workspace
 * derives multi-MB of vocabulary (measured: 4.2 MB for one production
 * workspace), which would ship in every context load — the exact payload class
 * schema bounding exists to prevent. Instead, `deriveModelStubs` provides the
 * cheap global name list (works on names-only bounded schemas), and full
 * models are derived server-side per request, scoped to the tables in play
 * (lib/semantic/models.server.ts → POST /api/semantic-models). Pass the full
 * names-only schema as `namingDatabases` so scoped derivation names agree with
 * the global stubs.
 *
 * Everything here is pure and connection-agnostic — dialect correctness lives
 * entirely in the IR layer (compile/detect), never here.
 */

import type {
  DatabaseWithSchema,
  SemanticDimension,
  SemanticMeasure,
  SemanticModel,
  TableRelationship,
} from '@/lib/types';

export type ColumnKind = 'dimension' | 'time' | 'measure' | 'id';

interface SchemaColumnLike {
  name: string;
  type: string;
  meta?: { category?: 'categorical' | 'numeric' | 'temporal' | 'text' | 'other' };
}

/** "order_items" / "order-items" / "WEB_EVENTS" → "Order Items" / "Web Events". */
export function humanizeName(raw: string): string {
  return raw
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const ID_NAME = /^(id|uuid|guid)$|(_id|_key|_uuid)$/i;
const NUMERIC_TYPE = /int|decimal|numeric|double|float|real|number|money/i;
const TEMPORAL_TYPE = /date|time/i;

/**
 * Classify one column into its derived vocabulary role. Id-like names win over
 * everything (a SUM over customer_id is never meaningful); then the profiled
 * category; then the SQL type name.
 */
export function classifyColumn(column: SchemaColumnLike): ColumnKind {
  if (ID_NAME.test(column.name)) return 'id';
  const category = column.meta?.category;
  if (category === 'numeric') return 'measure';
  if (category === 'temporal') return 'time';
  if (category) return 'dimension'; // categorical | text | other
  if (TEMPORAL_TYPE.test(column.type)) return 'time';
  if (NUMERIC_TYPE.test(column.type)) return 'measure';
  return 'dimension';
}

/** Preference order for the model's time axis among temporal columns. */
function timeColumnScore(name: string): number {
  const n = name.toLowerCase();
  if (n === 'created_at' || n === 'created') return 0;
  if (n.endsWith('_at')) return 1;
  if (n.includes('date') || n.includes('time')) return 2;
  return 3;
}

/** Strip a trailing id marker for measure naming: customer_id → "Customer". */
function idBaseName(column: string): string {
  const stripped = column.replace(/(_id|_key|_uuid)$/i, '');
  return humanizeName(stripped === column ? column : stripped);
}

const tableKey = (connection: string, schema: string | undefined, table: string) =>
  `${connection}|${schema ?? ''}|${table}`;

/**
 * Self-joins (same schema + table) are NOT supported: the derived join alias
 * is the target table's name, which would collide with the base table in the
 * generated SQL. Blocked at validation, filtered defensively at derivation,
 * and excluded from the target picker in the whitelist UI.
 */
export const isSelfJoin = (r: TableRelationship): boolean =>
  r.table === r.targetTable && (r.schema ?? '') === (r.targetSchema ?? '');

// ---------------------------------------------------------------------------
// Relationship views — bidirectional display + one-to-many sugar
// ---------------------------------------------------------------------------

/**
 * STORAGE is always normalized to the safe many→one direction (`table` is the
 * many side) so the semantic layer can never fan out. The UI, however, shows
 * each relationship from BOTH tables: from the many side as declared
 * (many-to-one), and from the one side as its mirror (one-to-many). A user may
 * also CREATE a relationship as one-to-many — sugar that normalizes on save.
 */
export type RelationshipCardinality = 'many_to_one' | 'one_to_one' | 'one_to_many';

export type RelationshipView = Omit<TableRelationship, 'relationship'> & {
  relationship?: RelationshipCardinality;
};

/** The same stored relationship, seen from the TARGET (one) side. */
export function mirrorRelationshipView(r: TableRelationship): RelationshipView {
  return {
    connection: r.connection,
    schema: r.targetSchema,
    table: r.targetTable,
    column: r.targetColumn,
    targetSchema: r.schema,
    targetTable: r.table,
    targetColumn: r.column,
    relationship: (r.relationship ?? 'many_to_one') === 'one_to_one' ? 'one_to_one' : 'one_to_many',
  };
}

/** Normalize a view back to storage: a one_to_many view swaps sides. */
export function normalizeRelationshipView(v: RelationshipView): TableRelationship {
  if (v.relationship !== 'one_to_many') return v as TableRelationship;
  return {
    connection: v.connection,
    schema: v.targetSchema,
    table: v.targetTable,
    column: v.targetColumn,
    targetSchema: v.schema,
    targetTable: v.table,
    targetColumn: v.column,
    relationship: 'many_to_one',
  };
}

/** The cheap, global "which models exist" projection — one stub per table. */
export interface ModelStub {
  name: string;
  connection: string;
  schema?: string;
  table: string;
}

/**
 * One stub per table with GLOBALLY disambiguated business names (same table
 * name in two schemas → "Events (prod)" / "Events (staging)"). Works on
 * names-only bounded schemas — columns are not needed for naming.
 */
export function deriveModelStubs(databases: DatabaseWithSchema[]): ModelStub[] {
  const stubs: ModelStub[] = [];
  for (const db of databases) {
    for (const s of db.schemas ?? []) {
      for (const t of s.tables ?? []) {
        stubs.push({ name: humanizeName(t.table), connection: db.databaseName, schema: s.schema, table: t.table });
      }
    }
  }
  // Names must be STRICTLY unique — they become spec references and React
  // keys. Disambiguate in widening steps: schema suffix, then the raw table
  // name (unique per connection.schema by construction).
  const count = (list: ModelStub[]) => {
    const c = new Map<string, number>();
    for (const st of list) c.set(st.name, (c.get(st.name) ?? 0) + 1);
    return c;
  };
  let counts = count(stubs);
  for (const st of stubs) {
    if ((counts.get(st.name) ?? 0) > 1) st.name = `${st.name} (${st.schema ?? st.connection})`;
  }
  counts = count(stubs);
  for (const st of stubs) {
    if ((counts.get(st.name) ?? 0) > 1) st.name = `${humanizeName(st.table)} (${st.schema ?? st.connection}.${st.table})`;
  }
  return stubs;
}

/**
 * Derive one semantic model per table (with columns) in `databases`.
 * `namingDatabases` (default: `databases`) supplies the GLOBAL table list used
 * for business-name disambiguation — pass the full whitelisted names-only
 * schema when deriving a scoped subset so names match `deriveModelStubs`.
 */
export function deriveSemanticModels(
  databases: DatabaseWithSchema[],
  relationships: TableRelationship[] = [],
  namingDatabases?: DatabaseWithSchema[],
): SemanticModel[] {
  const stubNames = new Map(
    deriveModelStubs(namingDatabases ?? databases).map((st) => [tableKey(st.connection, st.schema, st.table), st.name]),
  );
  // Index every table (for relationship targets + inherited filtering).
  const columnsByTable = new Map<string, SchemaColumnLike[]>();
  for (const db of databases) {
    for (const s of db.schemas ?? []) {
      for (const t of s.tables ?? []) {
        columnsByTable.set(tableKey(db.databaseName, s.schema, t.table), t.columns ?? []);
      }
    }
  }

  const models: SemanticModel[] = [];
  for (const db of databases) {
    for (const s of db.schemas ?? []) {
      for (const t of s.tables ?? []) {
        const columns = (t.columns ?? []) as SchemaColumnLike[];
        if (columns.length === 0) continue; // names-only (bounded) → inherited fallback below

        const dimensions: SemanticDimension[] = [];
        const measures: SemanticMeasure[] = [{ name: 'Count', agg: 'COUNT' }];
        const temporal: SchemaColumnLike[] = [];

        for (const c of columns) {
          const kind = classifyColumn(c);
          if (kind === 'dimension') {
            dimensions.push({ name: humanizeName(c.name), column: c.name });
          } else if (kind === 'time') {
            temporal.push(c);
            dimensions.push({ name: humanizeName(c.name), column: c.name, temporal: true });
          } else if (kind === 'id') {
            dimensions.push({ name: humanizeName(c.name), column: c.name });
            measures.push({ name: `Unique ${idBaseName(c.name)}`, agg: 'COUNT_DISTINCT', column: c.name });
          } else {
            measures.push({ name: `Total ${humanizeName(c.name)}`, agg: 'SUM', column: c.name });
            measures.push({ name: `Avg ${humanizeName(c.name)}`, agg: 'AVG', column: c.name });
          }
        }

        temporal.sort((a, b) => timeColumnScore(a.name) - timeColumnScore(b.name));
        const timeDimension = temporal.length > 0
          ? { column: temporal[0].name, label: humanizeName(temporal[0].name) }
          : undefined;

        // Declared relationships on this table → lookup joins + joined dimensions.
        const joins = relationships
          .filter((r) =>
            r.connection === db.databaseName &&
            (r.schema ?? '') === (s.schema ?? '') &&
            r.table === t.table &&
            r.column && r.targetTable && r.targetColumn &&
            !isSelfJoin(r),
          )
          .map((r) => ({
            table: r.targetTable,
            schema: r.targetSchema,
            alias: r.targetTable,
            type: 'LEFT' as const,
            relationship: r.relationship ?? ('many_to_one' as const),
            leftColumn: r.column,
            rightColumn: r.targetColumn,
          }));
        for (const join of joins) {
          const targetCols = columnsByTable.get(tableKey(db.databaseName, join.schema, join.table)) ?? [];
          for (const c of targetCols) {
            const kind = classifyColumn(c);
            if (kind === 'dimension' || kind === 'time') {
              dimensions.push({
                name: `${humanizeName(join.alias)} ${humanizeName(c.name)}`,
                column: c.name,
                join: join.alias,
                ...(kind === 'time' ? { temporal: true } : {}),
              });
            }
          }
        }

        models.push({
          name: stubNames.get(tableKey(db.databaseName, s.schema, t.table)) ?? humanizeName(t.table),
          connection: db.databaseName,
          schema: s.schema,
          table: t.table,
          timeDimension,
          dimensions,
          measures,
          ...(joins.length > 0 ? { joins } : {}),
        });
      }
    }
  }

  return models;
}

/** Config-gate validation for authored relationships (save-time, whitelist UI). */
export function validateTableRelationships(relationships: TableRelationship[] | undefined): string[] {
  const errors: string[] = [];
  for (const [i, r] of (relationships ?? []).entries()) {
    const at = `Relationship ${i + 1} (${r.table || '?'} → ${r.targetTable || '?'})`;
    if (!r.connection) errors.push(`${at}: missing connection`);
    if (!r.table) errors.push(`${at}: missing table`);
    if (!r.column) errors.push(`${at}: missing foreign-key column`);
    if (!r.targetTable) errors.push(`${at}: missing target table`);
    if (!r.targetColumn) errors.push(`${at}: missing target column`);
    if (r.relationship && r.relationship !== 'many_to_one' && r.relationship !== 'one_to_one') {
      errors.push(`${at}: relationship must be many_to_one or one_to_one`);
    }
    if (isSelfJoin(r)) {
      errors.push(`${at}: self-joins are not supported — the lookup must be a different table`);
    }
  }
  return errors;
}
