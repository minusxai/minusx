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

export const V2_SUPPORTED_VIZ_TYPES = ['bar', 'line', 'area', 'scatter', 'pie', 'row'] as const;
export type V2VizType = (typeof V2_SUPPORTED_VIZ_TYPES)[number];

const MARK_FOR_TYPE: Record<Exclude<V2VizType, 'row' | 'pie'>, string> = {
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

/** Switch a unit spec's viz type, transforming encodings where the shapes differ. */
export function setVizType(envelope: VizEnvelope, type: V2VizType): VizEnvelope {
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
