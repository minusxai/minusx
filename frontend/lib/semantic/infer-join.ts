/**
 * Join-column inference for the semantic-model editor (pure name heuristics).
 *
 * The editor calls these when the author picks a reference source or an m2m
 * bridge, so the join mapping is PROPOSED rather than hand-assembled — the
 * "bridge / primary / referenced" form soup this replaces was the single most
 * confusing part of authoring a model. Inference is deliberately conservative:
 * a null result means "show the pickers empty", never a wrong-but-plausible
 * mapping (a bad guess would silently compile a wrong join).
 *
 * No schema profiling and no FK metadata — names only, so it works identically
 * on every connector.
 */

export interface NamedColumn { name: string; type: string }

/** "products" → "product", "categories" → "category", "statuses" → "status". */
export function singularize(table: string): string {
  const t = table.toLowerCase();
  if (t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.endsWith('ses')) return t.slice(0, -2);
  if (t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

const has = (columns: NamedColumn[], name: string): boolean =>
  columns.some((c) => c.name.toLowerCase() === name.toLowerCase());

/** The column's exact stored spelling for a case-insensitive name hit. */
const spelledAs = (columns: NamedColumn[], name: string): string | undefined =>
  columns.find((c) => c.name.toLowerCase() === name.toLowerCase())?.name;

/** The `<singular>_id` FK column a table conventionally points at `table` with. */
const fkNameFor = (table: string): string => `${singularize(table)}_id`;

/**
 * Propose `on` pairs for a to-one reference. Order of preference:
 *  1. primary `<refSingular>_id` → ref `id` (the classic FK shape)
 *  2. a `*_id` column both sides spell identically (shared-key shape)
 */
export function inferToOneOn(
  primaryColumns: NamedColumn[],
  refColumns: NamedColumn[],
  refTable: string,
): Array<{ primaryColumn: string; referencedColumn: string }> | null {
  const fk = spelledAs(primaryColumns, fkNameFor(refTable));
  if (fk && has(refColumns, 'id')) {
    return [{ primaryColumn: fk, referencedColumn: spelledAs(refColumns, 'id')! }];
  }
  const shared = primaryColumns.find(
    (c) => /_id$/i.test(c.name) && has(refColumns, c.name),
  );
  if (shared) {
    return [{ primaryColumn: shared.name, referencedColumn: spelledAs(refColumns, shared.name)! }];
  }
  return null;
}

/**
 * Propose the full `through` mapping for an m2m reference. Every primaryKey
 * column must land on a bridge column (exact name, else the primary table's
 * conventional `<singular>_id`); the far side maps the bridge's
 * `<refSingular>_id` onto the ref's `id` (or an exactly-shared column).
 * Any unmappable part → null (never a partial guess).
 */
export function inferM2MThrough(args: {
  primaryKey: string[];
  primaryColumns: NamedColumn[];
  bridgeColumns: NamedColumn[];
  refColumns: NamedColumn[];
  primaryTable: string;
  refTable: string;
}): {
  primaryOn: Array<{ primaryColumn: string; bridgeColumn: string }>;
  referencedOn: Array<{ bridgeColumn: string; referencedColumn: string }>;
} | null {
  const { bridgeColumns, refColumns, primaryTable, refTable } = args;
  const pk = args.primaryKey.length > 0
    ? args.primaryKey
    : inferPrimaryKey(args.primaryColumns, primaryTable) ?? [];
  if (pk.length === 0) return null;

  const primaryOn: Array<{ primaryColumn: string; bridgeColumn: string }> = [];
  for (const col of pk) {
    // Exact-name carry-through first; a bare `id` pk maps onto the bridge's
    // conventional `<primarySingular>_id`.
    const bridge = spelledAs(bridgeColumns, col)
      ?? (col.toLowerCase() === 'id' ? spelledAs(bridgeColumns, fkNameFor(primaryTable)) : undefined);
    if (!bridge) return null;
    primaryOn.push({ primaryColumn: col, bridgeColumn: bridge });
  }

  const usedBridge = new Set(primaryOn.map((p) => p.bridgeColumn.toLowerCase()));
  const farFk = spelledAs(bridgeColumns, fkNameFor(refTable));
  if (farFk && !usedBridge.has(farFk.toLowerCase()) && has(refColumns, 'id')) {
    return { primaryOn, referencedOn: [{ bridgeColumn: farFk, referencedColumn: spelledAs(refColumns, 'id')! }] };
  }
  const shared = bridgeColumns.find(
    (c) => /_id$/i.test(c.name) && !usedBridge.has(c.name.toLowerCase()) && has(refColumns, c.name),
  );
  if (shared) {
    return { primaryOn, referencedOn: [{ bridgeColumn: shared.name, referencedColumn: spelledAs(refColumns, shared.name)! }] };
  }
  return null;
}

/** Propose the model's grain: a bare `id`, else the table's `<singular>_id`. */
export function inferPrimaryKey(primaryColumns: NamedColumn[], table: string): string[] | null {
  const id = spelledAs(primaryColumns, 'id');
  if (id) return [id];
  const conventional = spelledAs(primaryColumns, fkNameFor(table));
  return conventional ? [conventional] : null;
}
