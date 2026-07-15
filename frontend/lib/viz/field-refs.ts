/**
 * The shared field-reference walker (RFC §11): one traversal powers both
 * E_FIELD_NOT_FOUND validation and (later) fieldMeta injection.
 */

export interface FieldRef {
  /** JSON-pointer-ish path to the reference, e.g. '/layer/1/encoding/y/field'. */
  path: string;
  field: string;
}

// Vega-Lite view-composition containers whose children are (arrays of) sub-specs.
const SPEC_ARRAY_KEYS = ['layer', 'hconcat', 'vconcat', 'concat'] as const;

/** Channel defs that carry field references: the def itself, `condition`, and array defs. */
function collectFromChannelDef(def: unknown, path: string, out: FieldRef[]): void {
  if (Array.isArray(def)) {
    def.forEach((d, i) => collectFromChannelDef(d, `${path}/${i}`, out));
    return;
  }
  if (def == null || typeof def !== 'object') return;
  const rec = def as Record<string, unknown>;
  // `datum`/`value` encodings are not field references; `field` may also be a repeat
  // operator ref object ({repeat: …}) — only plain strings are result-column refs.
  if (typeof rec.field === 'string') out.push({ path: `${path}/field`, field: rec.field });
  if (rec.condition != null) collectFromChannelDef(rec.condition, `${path}/condition`, out);
}

function walk(spec: Record<string, unknown>, path: string, out: FieldRef[]): void {
  const encoding = spec.encoding as Record<string, unknown> | undefined;
  if (encoding && typeof encoding === 'object') {
    for (const [channel, def] of Object.entries(encoding)) {
      collectFromChannelDef(def, `${path}/encoding/${channel}`, out);
    }
  }
  // Facet operator: {facet: {row: {field}, column: {field}}} or {facet: {field}}
  const facet = spec.facet as Record<string, unknown> | undefined;
  if (facet && typeof facet === 'object') {
    if (typeof facet.field === 'string') out.push({ path: `${path}/facet/field`, field: facet.field });
    for (const axis of ['row', 'column'] as const) {
      const def = facet[axis] as Record<string, unknown> | undefined;
      if (def && typeof def === 'object' && typeof def.field === 'string') {
        out.push({ path: `${path}/facet/${axis}/field`, field: def.field });
      }
    }
  }
  for (const key of SPEC_ARRAY_KEYS) {
    const children = spec[key];
    if (Array.isArray(children)) {
      children.forEach((child, i) => {
        if (child && typeof child === 'object') walk(child as Record<string, unknown>, `${path}/${key}/${i}`, out);
      });
    }
  }
  // facet/repeat operators nest their unit under `spec`
  const nested = spec.spec;
  if (nested && typeof nested === 'object') walk(nested as Record<string, unknown>, `${path}/spec`, out);
}

/**
 * Collect every static field reference in a Vega-Lite spec: encoding channels
 * (including nested composites via layer/facet/concat/repeat) and the facet operator.
 * `datum`/`value` encodings are not field references. Fields produced by transforms
 * are legal refs — subtract collectDerivedFieldNames() before flagging unknowns.
 */
export function collectFieldRefs(spec: Record<string, unknown>): FieldRef[] {
  const out: FieldRef[] = [];
  walk(spec, '', out);
  return out;
}

/** Pull `as` output names out of one transform entry (string or string array). */
function addAs(as: unknown, out: Set<string>): void {
  if (typeof as === 'string') out.add(as);
  else if (Array.isArray(as)) for (const a of as) if (typeof a === 'string') out.add(a);
}

function collectDerivedFromSpec(spec: Record<string, unknown>, out: Set<string>): void {
  const transforms = spec.transform;
  if (Array.isArray(transforms)) {
    for (const t of transforms) {
      if (!t || typeof t !== 'object') continue;
      const tr = t as Record<string, unknown>;
      addAs(tr.as, out);
      if ('fold' in tr && tr.as == null) { out.add('key'); out.add('value'); }
      if ('quantile' in tr && tr.as == null) { out.add('prob'); out.add('value'); }
      if ('density' in tr && tr.as == null) { out.add('value'); out.add('density'); }
      if ('regression' in tr || 'loess' in tr) { /* outputs mirror the input field names */ }
      // Op-array transforms: window/aggregate/joinaggregate each declare per-op `as`.
      for (const opsKey of ['window', 'aggregate', 'joinaggregate'] as const) {
        const ops = tr[opsKey];
        if (Array.isArray(ops)) for (const op of ops) {
          if (op && typeof op === 'object') addAs((op as Record<string, unknown>).as, out);
        }
      }
    }
  }
  for (const key of SPEC_ARRAY_KEYS) {
    const children = spec[key];
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === 'object') collectDerivedFromSpec(child as Record<string, unknown>, out);
      }
    }
  }
  const nested = spec.spec;
  if (nested && typeof nested === 'object') collectDerivedFromSpec(nested as Record<string, unknown>, out);
}

/**
 * Collect the names a spec's transforms create (`as` outputs, fold defaults, window/
 * aggregate/joinaggregate op outputs, …) — references to these are legal even though
 * they're absent from the query result. NOTE: the `pivot` transform creates columns
 * from data VALUES, which is statically unverifiable — handled by the caller
 * (specs containing `pivot` skip unknown-field errors, RFC §11 dynamic-fields rule).
 */
export function collectDerivedFieldNames(spec: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  collectDerivedFromSpec(spec, out);
  return out;
}

/** True when the spec contains a transform whose outputs are statically unverifiable. */
export function hasUnverifiableTransform(spec: Record<string, unknown>): boolean {
  const transforms = spec.transform;
  if (Array.isArray(transforms) && transforms.some(t => t && typeof t === 'object' && 'pivot' in (t as object))) {
    return true;
  }
  for (const key of SPEC_ARRAY_KEYS) {
    const children = spec[key];
    if (Array.isArray(children) && children.some(c => c && typeof c === 'object' && hasUnverifiableTransform(c as Record<string, unknown>))) {
      return true;
    }
  }
  const nested = spec.spec;
  return nested != null && typeof nested === 'object' && hasUnverifiableTransform(nested as Record<string, unknown>);
}
