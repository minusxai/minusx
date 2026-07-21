/**
 * Derived semantic models — the draft-suggestion engine.
 *
 * A semantic model is pure vocabulary: which columns group (dimensions), which
 * aggregate (measures), and which column is the time axis. All of that is
 * derivable from the whitelisted schema + profiled column metadata
 * (`ColumnMeta.category`), so draft models are DERIVED on demand — one model
 * per table. Authored models (`ContextVersion.semanticModels`) are the source
 * of truth; derivation only pre-fills drafts and powers the stub name list.
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
  SemanticDimensionV2,
  SemanticMeasureV2,
  SemanticModelV2,
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
 * everything (a SUM over customer_id is never meaningful); temporal next; then
 * the SQL TYPE is the authority for measure-worthiness — profilers tag
 * low-cardinality integers (clicks, impressions) as "categorical" for LLM
 * context, and that must never strip a numeric column's aggregates. A
 * categorical-profiled numeric additionally stays groupable (derive adds a
 * dimension for it alongside the measures).
 */
export function classifyColumn(column: SchemaColumnLike): ColumnKind {
  if (ID_NAME.test(column.name)) return 'id';
  const category = column.meta?.category;
  if (category === 'temporal') return 'time';
  if (!category && TEMPORAL_TYPE.test(column.type)) return 'time';
  if (NUMERIC_TYPE.test(column.type)) return 'measure';
  if (category === 'numeric') return 'measure';
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
 * Derive one draft semantic model per table (with columns) in `databases`,
 * from the profiled schema alone.
 * `namingDatabases` (default: `databases`) supplies the GLOBAL table list used
 * for business-name disambiguation — pass the full whitelisted names-only
 * schema when deriving a scoped subset so names match `deriveModelStubs`.
 */
export function deriveSemanticModels(
  databases: DatabaseWithSchema[],
  namingDatabases?: DatabaseWithSchema[],
): SemanticModelV2[] {
  const stubNames = new Map(
    deriveModelStubs(namingDatabases ?? databases).map((st) => [tableKey(st.connection, st.schema, st.table), st.name]),
  );

  const models: SemanticModelV2[] = [];
  for (const db of databases) {
    for (const s of db.schemas ?? []) {
      for (const t of s.tables ?? []) {
        const columns = (t.columns ?? []) as SchemaColumnLike[];
        if (columns.length === 0) continue; // names-only (bounded) → inherited fallback below

        const dimensions: SemanticDimensionV2[] = [];
        const measures: SemanticMeasureV2[] = [{ name: 'Count', agg: 'COUNT' }];
        const temporal: SchemaColumnLike[] = [];

        for (const c of columns) {
          const kind = classifyColumn(c);
          if (kind === 'dimension') {
            dimensions.push({ name: humanizeName(c.name), column: c.name, source: 'primary' });
          } else if (kind === 'time') {
            temporal.push(c);
            dimensions.push({ name: humanizeName(c.name), column: c.name, source: 'primary', temporal: true });
          } else if (kind === 'id') {
            dimensions.push({ name: humanizeName(c.name), column: c.name, source: 'primary' });
            measures.push({ name: `Unique ${idBaseName(c.name)}`, agg: 'COUNT_DISTINCT', column: c.name });
          } else {
            measures.push({ name: `Total ${humanizeName(c.name)}`, agg: 'SUM', column: c.name });
            measures.push({ name: `Avg ${humanizeName(c.name)}`, agg: 'AVG', column: c.name });
            // Profiled categorical (low-cardinality) numerics stay groupable too.
            if (c.meta?.category === 'categorical') {
              dimensions.push({ name: humanizeName(c.name), column: c.name, source: 'primary' });
            }
          }
        }

        temporal.sort((a, b) => timeColumnScore(a.name) - timeColumnScore(b.name));
        const timeDimension = temporal.length > 0
          ? { column: temporal[0].name, label: humanizeName(temporal[0].name) }
          : undefined;

        models.push({
          name: stubNames.get(tableKey(db.databaseName, s.schema, t.table)) ?? humanizeName(t.table),
          connection: db.databaseName,
          primary: { kind: 'table', schema: s.schema, table: t.table },
          timeDimension,
          dimensions,
          measures,
        });
      }
    }
  }

  return models;
}
