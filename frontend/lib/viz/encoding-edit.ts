/**
 * Targeted encoding edits for the drop-zone lens over unit Vega-Lite specs.
 *
 * The RFC's cardinal rule: the UI must never parse a spec into a simplified model and
 * rewrite it. These helpers make SURGICAL edits only — set/replace/remove one encoding
 * channel's field, preserving every other property of the channel (axis, title, scale)
 * and everything else in the spec. Composed specs (layer/facet/concat/repeat) are not
 * editable here (isUnitVegaLiteSpec gates the panel); they're edited via chat.
 */
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizColumnKind } from './types';
import { getTemplate, VIZ_TEMPLATES } from './viz-templates';

export const EDITABLE_CHANNELS = ['x', 'y', 'color', 'theta'] as const;
export type EditableChannel = (typeof EDITABLE_CHANNELS)[number];

const COMPOSITION_KEYS = ['layer', 'hconcat', 'vconcat', 'concat', 'repeat', 'facet', 'spec'];

export function isUnitVegaLiteSpec(spec: Record<string, unknown>): boolean {
  return 'mark' in spec && !COMPOSITION_KEYS.some(k => k in spec);
}

/** The column a channel encodes, or null when absent / not a plain field reference. */
export function getChannelField(spec: Record<string, unknown>, channel: EditableChannel): string | null {
  const encoding = spec.encoding as Record<string, Record<string, unknown>> | undefined;
  const def = encoding?.[channel];
  return def && typeof def.field === 'string' ? def.field : null;
}

const KIND_TO_VL_TYPE: Record<VizColumnKind, string> = {
  quantitative: 'quantitative',
  temporal: 'temporal',
  nominal: 'nominal',
  boolean: 'nominal',
  unknown: 'nominal',
};

/**
 * Return a NEW envelope with `channel` encoding `column` (or removed when null).
 * Replaces only `field` + `type` on an existing channel def — its other props
 * (axis, title, scale, format…) survive. Everything else in the spec is untouched.
 */
export function setChannelField(
  envelope: VizEnvelope,
  channel: EditableChannel,
  column: { name: string; kind: VizColumnKind } | null,
): VizEnvelope {
  const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
  const spec = (next.source as { spec: Record<string, unknown> }).spec;
  const encoding = { ...(spec.encoding as Record<string, unknown> | undefined) } as Record<string, unknown>;
  if (column == null) {
    delete encoding[channel];
  } else {
    const existing = encoding[channel];
    const base = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
    const def: Record<string, unknown> = { ...base, field: column.name, type: KIND_TO_VL_TYPE[column.kind] };
    // A previous datum/value literal on this channel would fight the new field ref.
    delete def.datum;
    delete def.value;
    encoding[channel] = def;
  }
  spec.encoding = encoding;
  return next;
}

// ── Settings-tab surgical edits (same rule: one property, everything else survives) ──

const cloneEnvelope = (envelope: VizEnvelope): { next: VizEnvelope; spec: Record<string, unknown> } => {
  const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
  return { next, spec: (next.source as { spec: Record<string, unknown> }).spec };
};

const channelDef = (spec: Record<string, unknown>, channel: string): Record<string, unknown> | null => {
  const def = (spec.encoding as Record<string, unknown> | undefined)?.[channel];
  return def && typeof def === 'object' && !Array.isArray(def) ? (def as Record<string, unknown>) : null;
};

export function getMarkType(spec: Record<string, unknown>): string | null {
  const mark = spec.mark;
  if (typeof mark === 'string') return mark;
  if (mark && typeof mark === 'object') {
    const t = (mark as Record<string, unknown>).type;
    return typeof t === 'string' ? t : null;
  }
  return null;
}

/** Swap the mark type; a mark-def object keeps its other props (tooltip, cornerRadius…). */
export function setMarkType(envelope: VizEnvelope, type: string): VizEnvelope {
  const { next, spec } = cloneEnvelope(envelope);
  spec.mark = typeof spec.mark === 'object' && spec.mark != null
    ? { ...(spec.mark as Record<string, unknown>), type }
    : type;
  return next;
}

/** VL stacks bar/area by default; only an explicit null/false unstacks. */
export function getStacked(spec: Record<string, unknown>): boolean {
  const y = channelDef(spec, 'y');
  if (!y || !('stack' in y)) return true;
  return !(y.stack === null || y.stack === false);
}

export function setStacked(envelope: VizEnvelope, stacked: boolean): VizEnvelope {
  const { next, spec } = cloneEnvelope(envelope);
  const y = channelDef(spec, 'y');
  if (!y) return next;
  if (stacked) delete y.stack;
  else y.stack = null;
  return next;
}

// ── Viz-type switching (the icon selector) ─────────────────────────────────────────
//
// Cartesian marks are interchangeable (same positional encodings) — pure mark swaps.
// `row` swaps the x/y defs wholesale so axis/format config travels with the channel.
// `pie` is an encoding TRANSFORM: a naive mark swap to `arc` renders garbage because
// arcs read theta/color, not x/y.

export const V2_SUPPORTED_VIZ_TYPES = ['bar', 'line', 'area', 'scatter', 'pie', 'row', 'funnel', 'waterfall', 'radar'] as const;
export type V2VizType = (typeof V2_SUPPORTED_VIZ_TYPES)[number];

const MARK_FOR_TYPE: Record<Exclude<V2VizType, 'row' | 'pie' | 'funnel' | 'waterfall' | 'radar'>, string> = {
  bar: 'bar', line: 'line', area: 'area', scatter: 'point',
};

/** Classify a unit spec into a selector viz type (null when unrecognized). */
export function getVizType(spec: Record<string, unknown>): V2VizType | null {
  const mark = getMarkType(spec);
  if (mark === 'arc') return 'pie';
  if (mark === 'point') return 'scatter';
  if (mark === 'bar') {
    const x = channelDef(spec, 'x');
    const y = channelDef(spec, 'y');
    // Row = horizontal bar: the measure runs along x, the category/time along y.
    if (x?.type === 'quantitative' && y != null && y.type !== 'quantitative') return 'row';
    return 'bar';
  }
  if (mark === 'line' || mark === 'area') return mark;
  return null;
}

const withMark = (spec: Record<string, unknown>, type: string): void => {
  spec.mark = typeof spec.mark === 'object' && spec.mark != null
    ? { ...(spec.mark as Record<string, unknown>), type }
    : { type };
};

/** Native-spec viz types (recipes route through setEnvelopeVizType instead). */
export type SpecVizType = Exclude<V2VizType, 'funnel' | 'waterfall' | 'radar'>;

/** Switch a unit spec's viz type, transforming encodings where the shapes differ. */
export function setVizType(envelope: VizEnvelope, type: SpecVizType): VizEnvelope {
  const { next, spec } = cloneEnvelope(envelope);
  const encoding = { ...((spec.encoding as Record<string, unknown> | undefined) ?? {}) } as Record<string, Record<string, unknown> | undefined>;
  const from = getVizType(spec);

  // Leaving pie: restore positional channels from theta/color before anything else.
  if (from === 'pie' && type !== 'pie') {
    if (encoding.color && !encoding.x) encoding.x = { ...encoding.color };
    if (encoding.theta && !encoding.y) encoding.y = { ...encoding.theta };
    delete encoding.theta;
  }

  if (type === 'pie') {
    const value = encoding.y ?? encoding.theta;
    const slice = encoding.color ?? encoding.x;
    if (value) {
      const theta = { ...value };
      delete theta.axis; // meaningless on theta
      delete theta.stack;
      // VL draws one arc per DATUM — un-aggregated multi-row results become
      // hundreds of slivers per category. SUM matches the classic pipeline.
      if (theta.aggregate == null) theta.aggregate = 'sum';
      encoding.theta = theta;
    }
    if (slice) encoding.color = { ...slice };
    delete encoding.x;
    delete encoding.y;
    // Any remaining non-aggregated field channel joins the aggregate groupby and
    // re-shards the arcs (e.g. a weekly tooltip → 140 slivers per slice). Automatic
    // tooltips (theme) cover the donut; authors can re-add a custom list via chat.
    delete encoding.tooltip;
    delete encoding.detail;
    delete encoding.order;
    withMark(spec, 'arc');
    // House style (matches the ECharts pie builder): responsive donut with rounded,
    // slightly separated sectors (borderRadius: 6 / borderWidth: 2 over there).
    Object.assign(spec.mark as Record<string, unknown>, {
      innerRadius: { expr: 'min(width,height)/2 * 0.45' },
      cornerRadius: 6,
      padAngle: 0.015,
    });
  } else if (type === 'row') {
    const x = encoding.x;
    encoding.x = encoding.y;
    encoding.y = x;
    withMark(spec, 'bar');
  } else {
    // Coming FROM row, restore vertical orientation (swap back).
    if (from === 'row') {
      const x = encoding.x;
      encoding.x = encoding.y;
      encoding.y = x;
    }
    withMark(spec, MARK_FOR_TYPE[type]);
  }

  // The donut props only make sense on arcs — strip them when leaving pie.
  if (type !== 'pie' && spec.mark && typeof spec.mark === 'object') {
    const mark = spec.mark as Record<string, unknown>;
    delete mark.innerRadius;
    delete mark.cornerRadius;
    delete mark.padAngle;
  }

  for (const key of Object.keys(encoding)) if (encoding[key] === undefined) delete encoding[key];
  spec.encoding = encoding;
  return next;
}

/**
 * The drop zones a viz type actually uses — per-type, so a pie never offers
 * positional channels (assigning x/y to an arc draws overlapping wedges per position).
 */
export function zonesForVizType(type: V2VizType | null): Array<{ channel: EditableChannel; label: string }> {
  if (type === 'pie') {
    return [
      { channel: 'color', label: 'Slices' },
      { channel: 'theta', label: 'Value' },
    ];
  }
  return [
    { channel: 'x', label: 'X-Axis' },
    { channel: 'y', label: 'Y-Axis' },
    { channel: 'color', label: 'Color / Series' },
  ];
}

export function getYLogScale(spec: Record<string, unknown>): boolean {
  const scale = channelDef(spec, 'y')?.scale as Record<string, unknown> | undefined;
  return scale?.type === 'log';
}

export function setYLogScale(envelope: VizEnvelope, log: boolean): VizEnvelope {
  const { next, spec } = cloneEnvelope(envelope);
  const y = channelDef(spec, 'y');
  if (!y) return next;
  const scale = { ...((y.scale as Record<string, unknown> | undefined) ?? {}) };
  if (log) scale.type = 'log';
  else delete scale.type;
  if (Object.keys(scale).length > 0) y.scale = scale;
  else delete y.scale;
  return next;
}

// ── Envelope-level (source-aware) operations ────────────────────────────────────────
//
// The panel operates on envelopes, not bare specs: recipe sources classify/edit via
// their registry entry (bindings), native vega-lite sources via the spec itself.


type AnySource = Record<string, unknown>;
const sourceOf = (envelope: VizEnvelope): AnySource => envelope.source as unknown as AnySource;

export function getEnvelopeVizType(envelope: VizEnvelope): V2VizType | null {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') {
    return getTemplate(source.recipe as string)?.vizType ?? null;
  }
  return getVizType((source as { spec: Record<string, unknown> }).spec);
}

export function isEnvelopeEditable(envelope: VizEnvelope): boolean {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') return getTemplate(source.recipe as string) != null;
  return isUnitVegaLiteSpec((source as { spec: Record<string, unknown> }).spec);
}

/** Zone descriptors for the Fields tab: recipe bindings, or VL channels by type. */
export function getEnvelopeZones(envelope: VizEnvelope): Array<{ channel: string; label: string }> {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') {
    const template = getTemplate(source.recipe as string);
    return template ? template.bindings.map(b => ({ channel: b.name, label: b.label })) : [];
  }
  return zonesForVizType(getVizType((source as { spec: Record<string, unknown> }).spec));
}

/** The column a zone currently holds (binding value or channel field). */
export function getZoneField(envelope: VizEnvelope, channel: string): string | null {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') {
    const bindings = (source.bindings ?? {}) as Record<string, string>;
    return bindings[channel] ?? null;
  }
  return getChannelField((source as { spec: Record<string, unknown> }).spec, channel as EditableChannel);
}

/** Assign/remove a zone's column. Recipe bindings are required — removal is a no-op there. */
export function setZoneField(
  envelope: VizEnvelope,
  channel: string,
  column: { name: string; kind: VizColumnKind } | null,
): VizEnvelope {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') {
    const template = getTemplate(source.recipe as string);
    const binding = template?.bindings.find(b => b.name === channel);
    if (column == null && !binding?.optional) return envelope; // required bindings: re-bind instead
    const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
    const bindings = (next.source as unknown as AnySource).bindings as Record<string, string>;
    if (column == null) delete bindings[channel];
    else bindings[channel] = column.name;
    return next;
  }
  return setChannelField(envelope, channel as EditableChannel, column);
}

/** The bindings a template needs, inferred from whatever the current source encodes. */
function inferBindings(envelope: VizEnvelope): { category: string | null; value: string | null } {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') {
    const bindings = (source.bindings ?? {}) as Record<string, string>;
    return {
      category: bindings.stage ?? bindings.category ?? bindings.metric ?? null,
      value: bindings.value ?? null,
    };
  }
  const spec = (source as { spec: Record<string, unknown> }).spec;
  const pick = (channels: EditableChannel[], want: (def: Record<string, unknown>) => boolean): string | null => {
    for (const ch of channels) {
      const enc = (spec.encoding as Record<string, Record<string, unknown>> | undefined)?.[ch];
      if (enc && typeof enc.field === 'string' && want(enc)) return enc.field;
    }
    return null;
  };
  return {
    category: pick(['color', 'x', 'y'], d => d.type !== 'quantitative'),
    value: pick(['y', 'theta', 'x'], d => d.type === 'quantitative'),
  };
}

const TEMPLATE_FOR_TYPE: Partial<Record<V2VizType, string>> = {
  funnel: 'minusx/funnel@1',
  waterfall: 'minusx/waterfall@1',
  radar: 'minusx/radar@1',
};

/**
 * Envelope-level type switch. Recipe targets produce a REFERENCE source (bindings
 * inferred from the current encodings); leaving a recipe reconstructs a native
 * vega-lite source from its bindings, then applies the spec-level transform.
 */
export function setEnvelopeVizType(envelope: VizEnvelope, type: V2VizType): VizEnvelope {
  const templateId = TEMPLATE_FOR_TYPE[type];
  if (templateId) {
    const { category, value } = inferBindings(envelope);
    const template = getTemplate(templateId)!;
    const bindings: Record<string, string> = {};
    for (const b of template.bindings) {
      // Never auto-fill optional slots (radar's series): inferring the same column
      // for metric AND series yields degenerate single-point series polygons.
      if (b.optional) continue;
      const inferred = b.accepts.includes('quantitative') ? value : category;
      if (inferred) bindings[b.name] = inferred;
    }
    return {
      version: 2,
      source: { kind: 'recipe', recipe: templateId, bindings, params: null },
    } as unknown as VizEnvelope;
  }

  const source = sourceOf(envelope);
  if (source.kind === 'recipe') {
    // Reconstruct a plain bar from the bindings, then transform to the target type.
    const { category, value } = inferBindings(envelope);
    const barEnvelope = {
      version: 2,
      source: {
        kind: 'vega-lite',
        grammar: 'vega-lite@6',
        spec: {
          mark: { type: 'bar' },
          encoding: {
            ...(category ? { x: { field: category, type: 'nominal' } } : {}),
            ...(value ? { y: { field: value, type: 'quantitative', aggregate: 'sum' } } : {}),
          },
        },
      },
    } as unknown as VizEnvelope;
    return type === 'bar' ? barEnvelope : setVizType(barEnvelope, type as SpecVizType);
  }
  return setVizType(envelope, type as SpecVizType);
}

/** Recipe ids currently shipped (for docs/UI). */
export const SHIPPED_RECIPE_IDS = Object.keys(VIZ_TEMPLATES);

// ── Multi-measure Y (the classic yCols case) ────────────────────────────────────────
//
// A second quantitative column on Y folds the measures (RFC §4: wide data → `fold`),
// y reads the folded value and color the measure key. Agent-authored folds using the
// default output names ('key'/'value') are recognized and extended rather than
// wrapped in a second fold.

interface FoldInfo {
  index: number;
  fields: string[];
  as: [string, string];
}

const findYFold = (spec: Record<string, unknown>): FoldInfo | null => {
  const transforms = spec.transform;
  if (!Array.isArray(transforms)) return null;
  const y = channelDef(spec, 'y');
  if (!y || typeof y.field !== 'string') return null;
  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i] as Record<string, unknown>;
    if (!t || !Array.isArray(t.fold)) continue;
    const as = (Array.isArray(t.as) ? t.as : ['key', 'value']) as [string, string];
    if (y.field === as[1]) return { index: i, fields: t.fold as string[], as };
  }
  return null;
};

/** The measure columns Y currently carries (folded list, or the single field). */
export function getYFields(spec: Record<string, unknown>): string[] {
  const fold = findYFold(spec);
  if (fold) return fold.fields;
  const y = channelDef(spec, 'y');
  return y && typeof y.field === 'string' ? [y.field] : [];
}

/** Add a measure to Y: plain assign → fold-of-two → append to the fold. */
export function addYField(envelope: VizEnvelope, column: { name: string; kind: VizColumnKind }): VizEnvelope {
  const { next, spec } = cloneEnvelope(envelope);
  const encoding = { ...((spec.encoding as Record<string, unknown> | undefined) ?? {}) } as Record<string, Record<string, unknown> | undefined>;
  const y = encoding.y;

  const fold = findYFold(spec);
  if (fold) {
    const transforms = spec.transform as Record<string, unknown>[];
    const fields = fold.fields.includes(column.name) ? fold.fields : [...fold.fields, column.name];
    transforms[fold.index] = { ...transforms[fold.index], fold: fields };
    return next;
  }

  if (!y || typeof y.field !== 'string') {
    return setChannelField(next, 'y', column);
  }

  if (y.field === column.name) return next;

  // Fold the existing measure with the new one; the y def's presentation props
  // (axis, format…) carry over to the folded value.
  const foldTransform = { fold: [y.field, column.name], as: ['__mx_key', '__mx_value'] };
  spec.transform = [foldTransform, ...((spec.transform as unknown[] | undefined) ?? [])];
  encoding.y = { ...y, field: '__mx_value', type: 'quantitative' };
  const color = encoding.color;
  const colorIsFree = !color || typeof color.field !== 'string';
  if (colorIsFree) {
    encoding.color = { field: '__mx_key', type: 'nominal', title: null };
  }
  spec.encoding = encoding;
  return next;
}

/** Remove a measure from Y; unfolds back to a plain field when one remains. */
export function removeYField(envelope: VizEnvelope, name: string): VizEnvelope {
  const { next, spec } = cloneEnvelope(envelope);
  const encoding = { ...((spec.encoding as Record<string, unknown> | undefined) ?? {}) } as Record<string, Record<string, unknown> | undefined>;
  const fold = findYFold(spec);

  if (!fold) {
    return setChannelField(next, 'y', null);
  }

  const fields = fold.fields.filter(f => f !== name);
  const transforms = spec.transform as Record<string, unknown>[];
  if (fields.length > 1) {
    transforms[fold.index] = { ...transforms[fold.index], fold: fields };
    return next;
  }

  // One measure left: unfold. Restore the plain field on y (presentation props kept),
  // drop the fold transform, and drop a color channel that was only the measure key.
  const remaining = fields[0];
  transforms.splice(fold.index, 1);
  if (transforms.length === 0) delete spec.transform;
  if (remaining) {
    encoding.y = { ...(encoding.y ?? {}), field: remaining, type: 'quantitative' };
  } else {
    delete encoding.y;
  }
  if (encoding.color?.field === fold.as[0]) delete encoding.color;
  spec.encoding = encoding;
  return next;
}
