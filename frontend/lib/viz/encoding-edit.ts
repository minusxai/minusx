/**
 * Targeted encoding edits for the drop-zone lens over unit Vega-Lite specs.
 *
 * The RFC's cardinal rule: the UI must never parse a spec into a simplified model and
 * rewrite it. These helpers make SURGICAL edits only — set/replace/remove one encoding
 * channel's field, preserving every other property of the channel (axis, title, scale)
 * and everything else in the spec. Composed specs (layer/facet/concat/repeat) are not
 * editable here (isUnitVegaLiteSpec gates the panel); they're edited via chat.
 */
import type { VizEnvelope, ColumnFormatConfig, ConditionalFormatRule, PivotConfig } from '@/lib/validation/atlas-schemas';
import type { VizColumnKind } from './types';
import { getTemplate, VIZ_TEMPLATES } from './viz-templates';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { COLOR_PALETTE } from '@/lib/chart/echarts-theme';

export const EDITABLE_CHANNELS = ['x', 'y', 'color', 'theta'] as const;
export type EditableChannel = (typeof EDITABLE_CHANNELS)[number];

const COMPOSITION_KEYS = ['layer', 'hconcat', 'vconcat', 'concat', 'repeat', 'facet', 'spec'];

export function isUnitVegaLiteSpec(spec: Record<string, unknown>): boolean {
  return 'mark' in spec && !COMPOSITION_KEYS.some(k => k in spec);
}

// ── Annotated-unit recognition (annotations "in the fold") ──────────────────────────
//
// A spec of shape {layer: [unit chart, ...annotation layers]} — where every extra layer
// is a datum-only rule/rect/text (reference lines + their badge labels, ours or
// agent-authored) — is still treated as its BASE chart everywhere: type detection, the
// drop-zone lens, settings toggles, the shared tooltip. Purely structural, so no stored
// format changes; a layer with any FIELD encoding keeps the spec genuinely custom.

/** A datum/value-only rule, rect, or text layer — annotation chrome, not a data mark. */
function isAnnotationLayer(layer: unknown): boolean {
  const l = layer && typeof layer === 'object' && !Array.isArray(layer) ? (layer as Record<string, unknown>) : null;
  if (!l) return false;
  const markType = getMarkType(l);
  if (markType !== 'rule' && markType !== 'rect' && markType !== 'text') return false;
  const encoding = l.encoding;
  if (encoding == null || typeof encoding !== 'object' || Array.isArray(encoding)) return false;
  return Object.values(encoding as Record<string, unknown>).every(def => {
    if (def == null || typeof def !== 'object' || Array.isArray(def)) return false;
    return !('field' in (def as Record<string, unknown>));
  });
}

/** Split base chart from annotation layers; null when the spec isn't unit-or-annotated. */
export function annotationSplit(
  spec: Record<string, unknown>,
): { unit: Record<string, unknown>; annotations: Record<string, unknown>[] } | null {
  if (isUnitVegaLiteSpec(spec)) return { unit: spec, annotations: [] };
  if (COMPOSITION_KEYS.some(k => k !== 'layer' && k in spec)) return null;
  const layers = spec.layer;
  if (!Array.isArray(layers) || layers.length < 2) return null;
  const [first, ...rest] = layers;
  const base = first && typeof first === 'object' && !Array.isArray(first) ? (first as Record<string, unknown>) : null;
  if (!base || !isUnitVegaLiteSpec(base)) return null;
  if (!rest.every(isAnnotationLayer)) return null;
  return { unit: base, annotations: rest as Record<string, unknown>[] };
}

/** The editable UNIT of a spec — itself, or the base layer of an annotated spec. */
export const unitOf = (spec: Record<string, unknown>): Record<string, unknown> | null =>
  annotationSplit(spec)?.unit ?? null;

/** unitOf with a pass-through fallback (edit helpers operate on whatever is there). */
const unitOrSelf = (spec: Record<string, unknown>): Record<string, unknown> =>
  unitOf(spec) ?? spec;

/** The column a channel encodes, or null when absent / not a plain field reference. */
export function getChannelField(spec: Record<string, unknown>, channel: EditableChannel): string | null {
  const encoding = unitOrSelf(spec).encoding as Record<string, Record<string, unknown>> | undefined;
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
  const unit = unitOrSelf((next.source as { spec: Record<string, unknown> }).spec);
  const encoding = { ...(unit.encoding as Record<string, unknown> | undefined) } as Record<string, unknown>;
  if (column == null) {
    delete encoding[channel];
  } else {
    const existing = encoding[channel];
    const base = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
    // Heatmap rule (rect marks): x/y are DISCRETE bands. A temporal type would go
    // continuous and collapse the rows into one giant rect per category — the same
    // temporal→ordinal mapping the pivot→heatmap transform applies.
    const rectAxis = (channel === 'x' || channel === 'y') && getMarkType(unit) === 'rect';
    const vlType = rectAxis && column.kind === 'temporal' ? 'ordinal' : KIND_TO_VL_TYPE[column.kind];
    const def: Record<string, unknown> = { ...base, field: column.name, type: vlType };
    // A previous datum/value literal on this channel would fight the new field ref.
    delete def.datum;
    delete def.value;
    encoding[channel] = def;
  }
  unit.encoding = encoding;
  return next;
}

// ── Settings-tab surgical edits (same rule: one property, everything else survives) ──

const cloneEnvelope = (envelope: VizEnvelope): { next: VizEnvelope; spec: Record<string, unknown> } => {
  const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
  return { next, spec: (next.source as { spec: Record<string, unknown> }).spec };
};

const channelDef = (spec: Record<string, unknown>, channel: string): Record<string, unknown> | null => {
  const def = (unitOrSelf(spec).encoding as Record<string, unknown> | undefined)?.[channel];
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

interface ComboLayerFields {
  x: string;
  bar: string;
  line: string;
}

/**
 * Recognize the conservative raw-spec equivalent of the combo recipe. This is
 * intentionally structural rather than stylistic: colors, axis formatting, point
 * marks, and other authored presentation do not affect classification.
 */
function comboLayerFields(spec: Record<string, unknown>): ComboLayerFields | null {
  const layers = spec.layer;
  if (!Array.isArray(layers) || layers.length !== 2) return null;
  const resolve = spec.resolve as { scale?: { y?: unknown } } | undefined;
  if (resolve?.scale?.y !== 'independent') return null;

  const units = layers.filter((layer): layer is Record<string, unknown> =>
    layer != null && typeof layer === 'object' && !Array.isArray(layer));
  const bar = units.find(layer => getMarkType(layer) === 'bar');
  const line = units.find(layer => getMarkType(layer) === 'line');
  if (!bar || !line) return null;

  const fields = (layer: Record<string, unknown>) => {
    const encoding = layer.encoding as Record<string, Record<string, unknown>> | undefined;
    const x = encoding?.x;
    const y = encoding?.y;
    return {
      x: typeof x?.field === 'string' ? x.field : null,
      y: typeof y?.field === 'string' && y.type === 'quantitative' ? y.field : null,
    };
  };
  const barFields = fields(bar);
  const lineFields = fields(line);
  if (!barFields.x || !barFields.y || !lineFields.x || !lineFields.y) return null;
  if (barFields.x !== lineFields.x) return null;
  return { x: barFields.x, bar: barFields.y, line: lineFields.y };
}

export function isComboVegaLiteSpec(spec: Record<string, unknown>): boolean {
  return comboLayerFields(spec) != null;
}

/** Swap the mark type; a mark-def object keeps its other props (tooltip, cornerRadius…). */
export function setMarkType(envelope: VizEnvelope, type: string): VizEnvelope {
  const { next, spec } = cloneEnvelope(envelope);
  const unit = unitOrSelf(spec);
  unit.mark = typeof unit.mark === 'object' && unit.mark != null
    ? { ...(unit.mark as Record<string, unknown>), type }
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

export const V2_SUPPORTED_VIZ_TYPES = ['table', 'pivot', 'bar', 'line', 'area', 'scatter', 'pie', 'row', 'combo', 'funnel', 'waterfall', 'radar', 'heatmap', 'boxplot', 'trend', 'single_value', 'histogram', 'choropleth', 'point_map'] as const;
export type V2VizType = (typeof V2_SUPPORTED_VIZ_TYPES)[number];

const MARK_FOR_TYPE: Record<Exclude<V2VizType, 'table' | 'pivot' | 'row' | 'pie' | 'heatmap' | 'combo' | 'funnel' | 'waterfall' | 'radar' | 'trend' | 'single_value' | 'histogram' | 'choropleth' | 'point_map'>, string> = {
  bar: 'bar', line: 'line', area: 'area', scatter: 'point', boxplot: 'boxplot',
};

/** Classify a unit (or annotated-unit) spec into a selector viz type (null when unrecognized). */
export function getVizType(spec: Record<string, unknown>): V2VizType | null {
  spec = unitOrSelf(spec);
  const mark = getMarkType(spec);
  if (mark === 'arc') return 'pie';
  if (mark === 'rect') return 'heatmap';
  if (mark === 'point') return 'scatter';
  if (mark === 'boxplot') return 'boxplot';
  if (mark === 'bar') {
    const x = channelDef(spec, 'x');
    const y = channelDef(spec, 'y');
    // Histogram = a binned x (distribution plot). Checked before row: a binned x
    // is quantitative and would misread as a plain bar.
    if (x != null && x.bin != null && x.bin !== false) return 'histogram';
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

/** Native-spec viz types (recipes and the DOM table route through setEnvelopeVizType instead). */
export type SpecVizType = Exclude<V2VizType, 'table' | 'pivot' | 'combo' | 'funnel' | 'waterfall' | 'radar' | 'trend' | 'single_value' | 'choropleth' | 'point_map'>;

/** Switch a unit (or annotated-unit) spec's viz type, transforming encodings where the
 *  shapes differ. Annotation layers ride along untouched. */
export function setVizType(envelope: VizEnvelope, type: SpecVizType): VizEnvelope {
  const { next, spec: outerSpec } = cloneEnvelope(envelope);
  const spec = unitOrSelf(outerSpec);
  const encoding = { ...((spec.encoding as Record<string, unknown> | undefined) ?? {}) } as Record<string, Record<string, unknown> | undefined>;
  const from = getVizType(spec);

  // Leaving pie: the slice category (color) becomes the x-axis, theta becomes y. Keep the
  // color too (bar/scatter render nicely coloured by category); the redundant-color cleanup
  // below drops it for line/area, where color === x would break the connecting line.
  if (from === 'pie' && type !== 'pie') {
    if (encoding.color && !encoding.x) encoding.x = { ...encoding.color };
    if (encoding.theta && !encoding.y) encoding.y = { ...encoding.theta };
    delete encoding.theta;
  }

  // Leaving histogram: the measure lives on binned x (count on y) — restore it to
  // y (bin stripped). The original category was dropped entering histogram, so x
  // stays empty; the user re-adds one via the zones.
  if (from === 'histogram' && type !== 'histogram') {
    const measure = encoding.x ? { ...encoding.x } : undefined;
    delete encoding.x;
    delete encoding.y; // the implicit count def
    if (measure) {
      delete measure.bin;
      encoding.y = measure;
    }
  }

  // Leaving heatmap: the measure lives on color and the second category on y —
  // restore the cartesian shape (measure → y, category → color/series).
  if (from === 'heatmap' && type !== 'heatmap') {
    const measure = encoding.color;
    const series = encoding.y;
    if (measure) encoding.y = { ...measure };
    if (series) encoding.color = { ...series };
    else delete encoding.color;
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
    // Minimal mark only — the house donut styling (responsive innerRadius, rounded,
    // padded) is the theme's config.arc, so this saved spec stays identical to what
    // an agent authors and both render the same.
    withMark(spec, 'arc');
  } else if (type === 'heatmap') {
    // Heatmap = two discrete axes + the measure as colour. The y measure moves
    // to color (SUM-aggregated like pie), the colour series (if any) becomes y.
    const measure = encoding.y;
    const series = encoding.color;
    if (measure) {
      const color = { ...measure };
      delete color.axis;
      delete color.stack;
      if (color.aggregate == null) color.aggregate = 'sum';
      encoding.color = color;
    }
    if (series) {
      const y = { ...series };
      delete y.scale; // colour scales (scheme/range) are meaningless on an axis
      encoding.y = y;
    } else {
      delete encoding.y;
    }
    delete encoding.tooltip;
    delete encoding.detail;
    delete encoding.order;
    withMark(spec, 'rect');
  } else if (type === 'histogram') {
    // Histogram = distribution plot: the measure binned along x, record count on
    // y, optional discrete colour split. Coming from row the measure sits on x —
    // normalize to the vertical shape first.
    if (from === 'row') {
      const x = encoding.x;
      encoding.x = encoding.y;
      encoding.y = x;
    }
    const measure = encoding.y;
    if (measure) {
      const x = { ...measure };
      delete x.aggregate; // bin and aggregate fight; the histogram aggregates by COUNT
      delete x.stack;
      x.bin = true;
      x.type = 'quantitative';
      encoding.x = x; // the measure's presentation (axis, title…) travels to the values axis
    } else {
      delete encoding.x; // no measure to bin — the category axis means nothing here
    }
    encoding.y = { aggregate: 'count', type: 'quantitative' };
    // Non-aggregated field channels would join the count groupby and re-shard the
    // bins (same rule as pie/heatmap); automatic tooltips cover the bars.
    delete encoding.tooltip;
    delete encoding.detail;
    delete encoding.order;
    withMark(spec, 'bar');
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
    // The boxplot composite mark aggregates internally (q1/median/q3/whiskers) —
    // a pre-aggregated y feeds ONE value per group (degenerate box), and stack is
    // meaningless on it. Presentation props (axis, title…) survive.
    if (type === 'boxplot' && encoding.y) {
      encoding.y = { ...encoding.y };
      delete encoding.y.aggregate;
      delete encoding.y.stack;
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

  // Channel hygiene: a def moved between channels must not carry a property that's invalid
  // on its new channel. `legend` belongs to color/size/shape, NOT positional x/y (Vega-Lite
  // silently renders NOTHING for `x: {…, legend}` — e.g. the pie→bar switch, whose x is
  // copied from the pie's `color`). `axis` is the reverse (positional-only) on color.
  for (const ch of ['x', 'y'] as const) {
    const d = encoding[ch];
    if (d && typeof d === 'object' && !Array.isArray(d)) delete (d as Record<string, unknown>).legend;
  }
  const colorDef = encoding.color as Record<string, unknown> | undefined;
  if (colorDef && typeof colorDef === 'object' && !Array.isArray(colorDef)) delete colorDef.axis;

  // A color that duplicates the x field is redundant everywhere and BREAKS line/area:
  // color === x splits the data into single-point series → isolated dots, no line. Drop it
  // for line/area (bar/scatter keep it — coloured-by-category is a fine look there).
  if ((type === 'line' || type === 'area') && colorDef?.field != null
    && colorDef.field === (encoding.x as Record<string, unknown> | undefined)?.field) {
    delete encoding.color;
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
  if (type === 'heatmap') {
    return [
      { channel: 'x', label: 'X-Axis' },
      { channel: 'y', label: 'Y-Axis' },
      { channel: 'color', label: 'Value' },
    ];
  }
  if (type === 'pie') {
    return [
      { channel: 'color', label: 'Slices' },
      { channel: 'theta', label: 'Value' },
    ];
  }
  if (type === 'histogram') {
    // y is the implicit record count — only the binned measure and the split are
    // author-assignable.
    return [
      { channel: 'x', label: 'Values' },
      { channel: 'color', label: 'Color / Split' },
    ];
  }
  return [
    { channel: 'x', label: 'X-Axis' },
    { channel: 'y', label: 'Y-Axis' },
    { channel: 'color', label: 'Color / Series' },
  ];
}

/**
 * Histogram bin cap (the Settings "Max bins" control). null = automatic: VL's
 * default binning targets at most ~10 nice-stepped bins. Read from the x
 * channel's `bin` — `true` or a param object without `maxbins` both read as auto.
 */
export function getMaxBins(spec: Record<string, unknown>): number | null {
  const bin = channelDef(spec, 'x')?.bin;
  if (bin == null || bin === true || bin === false || typeof bin !== 'object') return null;
  const maxbins = (bin as Record<string, unknown>).maxbins;
  return typeof maxbins === 'number' ? maxbins : null;
}

/** Set/clear (null) the bin cap; other author bin params (step, extent…) survive. */
export function setMaxBins(envelope: VizEnvelope, maxbins: number | null): VizEnvelope {
  const { next, spec } = cloneEnvelope(envelope);
  const x = channelDef(spec, 'x');
  if (!x || x.bin == null || x.bin === false) return next; // only binned specs
  const bin = typeof x.bin === 'object' ? { ...(x.bin as Record<string, unknown>) } : {};
  if (maxbins == null) delete bin.maxbins;
  else bin.maxbins = maxbins;
  x.bin = Object.keys(bin).length > 0 ? bin : true;
  return next;
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

// ── Y bounds + line interpolation (V1 AxisConfig yMin/yMax + smoothing, spec-native) ──

/** Explicit Y-axis bounds. domainMin/domainMax (not a full domain pin) so each side is independent. */
export function getYBounds(spec: Record<string, unknown>): { min: number | null; max: number | null } {
  const scale = channelDef(spec, 'y')?.scale as Record<string, unknown> | undefined;
  return {
    min: typeof scale?.domainMin === 'number' ? scale.domainMin : null,
    max: typeof scale?.domainMax === 'number' ? scale.domainMax : null,
  };
}

/**
 * Set/clear (null) either Y bound; `undefined` leaves a side as-is. Other scale props
 * survive. Any active bound also sets `mark.clip` — without it, marks beyond the bound
 * keep their full extent and the render-time autosize:fit collapses the plot (ECharts
 * clipped implicitly; Vega-Lite must be told). Clearing both bounds removes the clip.
 */
export function setYBounds(envelope: VizEnvelope, bounds: { min?: number | null; max?: number | null }): VizEnvelope {
  const { next, spec } = cloneEnvelope(envelope);
  const y = channelDef(spec, 'y');
  if (!y) return next;
  const scale = { ...((y.scale as Record<string, unknown> | undefined) ?? {}) };
  if (bounds.min !== undefined) {
    if (bounds.min === null) delete scale.domainMin;
    else scale.domainMin = bounds.min;
  }
  if (bounds.max !== undefined) {
    if (bounds.max === null) delete scale.domainMax;
    else scale.domainMax = bounds.max;
  }
  if (Object.keys(scale).length > 0) y.scale = scale;
  else delete y.scale;

  const bounded = scale.domainMin !== undefined || scale.domainMax !== undefined;
  const unit = unitOrSelf(spec);
  const mark: Record<string, unknown> = typeof unit.mark === 'string' ? { type: unit.mark } : { ...(asPlainRecord(unit.mark) ?? {}) };
  if (bounded) mark.clip = true;
  else delete mark.clip;
  unit.mark = mark;
  return next;
}

export type LineInterpolate = 'linear' | 'monotone' | 'step';

/** The line/area interpolation ('linear' is VL's implicit default). */
export function getLineInterpolate(spec: Record<string, unknown>): LineInterpolate {
  const mark = asPlainRecord(unitOrSelf(spec).mark);
  const interp = mark?.interpolate;
  return interp === 'monotone' || interp === 'step' ? interp : 'linear';
}

/** Set the interpolation; 'linear' removes the prop (the default stays implicit). */
export function setLineInterpolate(envelope: VizEnvelope, interpolate: LineInterpolate): VizEnvelope {
  const { next, spec } = cloneEnvelope(envelope);
  const unit = unitOrSelf(spec);
  const mark: Record<string, unknown> = typeof unit.mark === 'string' ? { type: unit.mark } : { ...(asPlainRecord(unit.mark) ?? {}) };
  if (interpolate === 'linear') delete mark.interpolate;
  else mark.interpolate = interpolate;
  unit.mark = mark;
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
  if (source.kind === 'table') return 'table';
  if (source.kind === 'pivot') return 'pivot';
  if (source.kind === 'recipe') {
    return getTemplate(source.recipe as string)?.vizType ?? null;
  }
  const spec = (source as { spec: Record<string, unknown> }).spec;
  if (isComboVegaLiteSpec(spec)) return 'combo';
  return getVizType(spec);
}

/**
 * Whether an envelope renders to a CHART image (Viz Arch V2 §21 item 2). Everything
 * except the DOM-tier table/pivot sources is image-able — vega-lite, native vega (incl.
 * detached specs), and every recipe. Mirrors the ECharts `isImageViz` gate but for V2.
 */
export function isEnvelopeImageViz(envelope: VizEnvelope): boolean {
  const kind = sourceOf(envelope).kind;
  return kind !== 'table' && kind !== 'pivot';
}

export function isEnvelopeEditable(envelope: VizEnvelope): boolean {
  const source = sourceOf(envelope);
  if (source.kind === 'table' || source.kind === 'pivot') return true;
  if (source.kind === 'recipe') return getTemplate(source.recipe as string) != null;
  return unitOf((source as { spec: Record<string, unknown> }).spec) != null;
}

/** Zone descriptors for the Fields tab: recipe bindings, or VL channels by type. */
export function getEnvelopeZones(envelope: VizEnvelope): Array<{ channel: string; label: string }> {
  const source = sourceOf(envelope);
  // Tables have no encodings — columns are managed on the table itself (headers/toolbar).
  // Pivot zones (Rows/Columns/Values) are owned by the PivotAxisBuilder, not this lens.
  if (source.kind === 'table' || source.kind === 'pivot') return [];
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
    const bound = ((source.bindings ?? {}) as Record<string, string | string[]>)[channel];
    if (Array.isArray(bound)) return bound[0] ?? null;
    return bound ?? null;
  }
  return getChannelField((source as { spec: Record<string, unknown> }).spec, channel as EditableChannel);
}

/**
 * All columns a zone holds. Multi-capable zones (native cartesian Y via fold, or a
 * recipe slot with `multi`) return the full list; single zones return 0–1 items.
 */
export function getZoneFields(envelope: VizEnvelope, channel: string): string[] {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') {
    const bound = ((source.bindings ?? {}) as Record<string, string | string[]>)[channel];
    if (bound == null || bound === '') return [];
    return Array.isArray(bound) ? bound : [bound];
  }
  const spec = (source as { spec: Record<string, unknown> }).spec;
  if (channel === 'y') return getYFields(spec);
  const f = getChannelField(spec, channel as EditableChannel);
  return f ? [f] : [];
}

/** Whether a zone accepts multiple columns. */
export function isMultiZone(envelope: VizEnvelope, channel: string): boolean {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') {
    return getTemplate(source.recipe as string)?.bindings.find(b => b.name === channel)?.multi ?? false;
  }
  return channel === 'y' && unitOf((source as { spec: Record<string, unknown> }).spec) != null;
}

/** Add a column to a multi zone (append) or assign a single zone. */
export function addZoneField(envelope: VizEnvelope, channel: string, column: { name: string; kind: VizColumnKind }): VizEnvelope {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') {
    if (!isMultiZone(envelope, channel)) return setZoneField(envelope, channel, column);
    const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
    const bindings = (next.source as unknown as AnySource).bindings as Record<string, string | string[]>;
    const current = bindings[channel];
    const list = current == null || current === '' ? [] : Array.isArray(current) ? current : [current];
    if (!list.includes(column.name)) list.push(column.name);
    bindings[channel] = list.length === 1 ? list[0] : list;
    return next;
  }
  if (channel === 'y') return addYField(envelope, column);
  return setZoneField(envelope, channel, column);
}

/** Remove one column from a zone (multi-aware). */
export function removeZoneField(envelope: VizEnvelope, channel: string, name: string): VizEnvelope {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') {
    if (!isMultiZone(envelope, channel)) return setZoneField(envelope, channel, null);
    const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
    const bindings = (next.source as unknown as AnySource).bindings as Record<string, string | string[]>;
    const current = bindings[channel];
    const list = (Array.isArray(current) ? current : [current]).filter((f): f is string => typeof f === 'string' && f !== name);
    if (list.length === 0) {
      const template = getTemplate(source.recipe as string);
      if (template?.bindings.find(b => b.name === channel)?.optional) delete bindings[channel];
      else return envelope; // required multi slot keeps its last column
    } else {
      bindings[channel] = list.length === 1 ? list[0] : list;
    }
    return next;
  }
  if (channel === 'y') return removeYField(envelope, name);
  return setZoneField(envelope, channel, null);
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
  if (source.kind === 'table') return { category: null, value: null }; // no encodings to read
  if (source.kind === 'pivot') {
    const config = source.config as { rows?: string[]; columns?: string[]; values?: Array<{ column: string }> } | undefined;
    return {
      category: config?.rows?.[0] ?? config?.columns?.[0] ?? null,
      value: config?.values?.[0]?.column ?? null,
    };
  }
  if (source.kind === 'recipe') {
    const bindings = (source.bindings ?? {}) as Record<string, string>;
    return {
      category: bindings.stage ?? bindings.category ?? bindings.metric ?? bindings.x ?? null,
      value: bindings.value ?? bindings.bar ?? bindings.line ?? null,
    };
  }
  const spec = (source as { spec: Record<string, unknown> }).spec;
  const combo = comboLayerFields(spec);
  if (combo) return { category: combo.x, value: combo.bar };
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
  combo: 'minusx/combo@1',
  funnel: 'minusx/funnel@1',
  waterfall: 'minusx/waterfall@1',
  radar: 'minusx/radar@1',
  trend: 'minusx/trend@1',
  single_value: 'minusx/single-value@1',
  choropleth: 'minusx/choropleth@1',
  point_map: 'minusx/point-map@1',
};

/** Guess the lat/lng columns for a point map: name-matched first, else the first two numbers. */
function inferLatLng(columns?: Array<{ name: string; kind: VizColumnKind }>): { lat: string | null; lng: string | null } {
  const nums = (columns ?? []).filter(c => c.kind === 'quantitative').map(c => c.name);
  const byName = (re: RegExp) => nums.find(n => re.test(n));
  const lat = byName(/^lat|latitude/i) ?? nums[0] ?? null;
  const lng = byName(/^(lng|lon|long)|longitude/i) ?? nums.find(n => n !== lat) ?? null;
  return { lat, lng };
}

/**
 * Envelope-level type switch. Recipe targets produce a REFERENCE source (bindings
 * inferred from the current encodings); the table target produces a bare DOM-table
 * source; leaving a recipe/table reconstructs a native vega-lite source from its
 * bindings (or, for tables — which have no encodings — from the result `columns`
 * fallback), then applies the spec-level transform.
 */
export function setEnvelopeVizType(
  envelope: VizEnvelope,
  type: V2VizType,
  columns?: Array<{ name: string; kind: VizColumnKind }>,
): VizEnvelope {
  if (type === 'table') {
    return {
      version: 2,
      source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null },
    } as unknown as VizEnvelope;
  }

  // Inference falls back to the result columns (first categorical / first measure)
  // when the current source has nothing to read — the classic table→chart behavior.
  const inferred = inferBindings(envelope);
  const category = inferred.category ?? columns?.find(c => c.kind !== 'quantitative')?.name ?? null;
  const value = inferred.value ?? columns?.find(c => c.kind === 'quantitative')?.name ?? null;
  // The category's VL type comes from its COLUMN KIND — never hardcode nominal: a
  // temporal column typed nominal band-scales into one bar per timestamp (mangled axis).
  const categoryKind = (category != null ? columns?.find(c => c.name === category)?.kind : undefined) ?? 'nominal';
  const categoryVlType = KIND_TO_VL_TYPE[categoryKind];

  if (type === 'pivot') {
    return {
      version: 2,
      source: {
        kind: 'pivot',
        config: {
          rows: category ? [category] : [],
          columns: [],
          values: value ? [{ column: value, aggFunction: 'SUM' }] : [],
        },
        columnFormats: null,
        css: null,
      },
    } as unknown as VizEnvelope;
  }

  const templateId = TEMPLATE_FOR_TYPE[type];
  if (templateId) {
    const template = getTemplate(templateId)!;
    const bindings: Record<string, string> = {};
    if (type === 'combo') {
      const measures = [
        value,
        ...(columns ?? []).filter(c => c.kind === 'quantitative').map(c => c.name),
      ].filter((name, index, all): name is string => name != null && all.indexOf(name) === index);
      if (category) bindings.x = category;
      if (measures[0]) bindings.bar = measures[0];
      // Keep the recipe renderable with a one-measure result; the Line zone remains
      // replaceable as soon as another measure is available.
      if (measures[1] ?? measures[0]) bindings.line = measures[1] ?? measures[0];
      return {
        version: 2,
        source: { kind: 'recipe', recipe: templateId, bindings, params: null },
      } as unknown as VizEnvelope;
    }
    if (type === 'point_map') {
      // lat/lng are two DISTINCT numbers — the generic value/category split can't
      // infer them; guess by name (else first two numeric columns). Destination /
      // size / color stay unbound (the user adds them in Fields).
      const { lat, lng } = inferLatLng(columns);
      if (lat) bindings.lat = lat;
      if (lng) bindings.lng = lng;
      return {
        version: 2,
        source: { kind: 'recipe', recipe: templateId, bindings, params: null },
      } as unknown as VizEnvelope;
    }
    for (const b of template.bindings) {
      // Never auto-fill optional slots (radar's series): inferring the same column
      // for metric AND series yields degenerate single-point series polygons.
      if (b.optional) continue;
      const bound = b.accepts.includes('quantitative') ? value : category;
      if (bound) bindings[b.name] = bound;
    }
    return {
      version: 2,
      source: { kind: 'recipe', recipe: templateId, bindings, params: null },
    } as unknown as VizEnvelope;
  }

  const source = sourceOf(envelope);
  if (type === 'heatmap' && (source.kind === 'recipe' || source.kind === 'table' || source.kind === 'pivot')) {
    // Heatmap needs TWO discrete axes — the pivot's structure maps directly
    // (columns[0] → x, rows[0] → y, values[0] → colour); other sources fall back
    // to the first two categorical result columns.
    let xCat: string | null = null;
    let yCat: string | null = null;
    let measure: string | null = value;
    if (source.kind === 'pivot') {
      const cfg = source.config as { rows?: string[]; columns?: string[]; values?: Array<{ column?: string }> };
      xCat = cfg.columns?.[0] ?? null;
      yCat = cfg.rows?.[0] ?? null;
      measure = cfg.values?.[0]?.column ?? value;
    }
    const cats = (columns ?? []).filter(c => c.kind !== 'quantitative').map(c => c.name);
    xCat = xCat ?? cats.find(c => c !== yCat) ?? null;
    yCat = yCat ?? cats.find(c => c !== xCat) ?? null;
    // Discrete axes only: a temporal kind renders as ordered bands (ordinal),
    // never a continuous time scale (rect slivers). Kinds still come from the
    // COLUMN KIND — nothing is invented.
    const axisType = (name: string | null): string => {
      const kind = (name != null ? columns?.find(c => c.name === name)?.kind : undefined) ?? 'nominal';
      return kind === 'temporal' ? 'ordinal' : KIND_TO_VL_TYPE[kind];
    };
    return {
      version: 2,
      source: {
        kind: 'vega-lite',
        grammar: 'vega-lite@6',
        spec: {
          mark: { type: 'rect' },
          encoding: {
            ...(xCat ? { x: { field: xCat, type: axisType(xCat) } } : {}),
            ...(yCat ? { y: { field: yCat, type: axisType(yCat) } } : {}),
            ...(measure ? { color: { field: measure, aggregate: 'sum', type: 'quantitative' } } : {}),
          },
        },
      },
    } as unknown as VizEnvelope;
  }
  const needsReconstruction = source.kind === 'recipe' || source.kind === 'table' || source.kind === 'pivot' ||
    (source.kind === 'vega-lite' && unitOf((source as { spec: Record<string, unknown> }).spec) == null);
  if (needsReconstruction) {
    // Reconstruct a plain bar from the bindings/columns, then transform to the target.
    const barEnvelope = {
      version: 2,
      source: {
        kind: 'vega-lite',
        grammar: 'vega-lite@6',
        spec: {
          mark: { type: 'bar' },
          encoding: {
            ...(category ? { x: { field: category, type: categoryVlType } } : {}),
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

// ── Recipe params (surgical, like every other envelope edit) ────────────────────

export function getRecipeParams(envelope: VizEnvelope): Record<string, unknown> {
  const source = sourceOf(envelope);
  if (source.kind !== 'recipe') return {};
  return (source.params as Record<string, unknown> | null | undefined) ?? {};
}

/** Upsert one recipe param; `undefined` removes it (defaults stay clean). */
export function setRecipeParam(envelope: VizEnvelope, key: string, value: unknown): VizEnvelope {
  const source = sourceOf(envelope);
  if (source.kind !== 'recipe') return envelope;
  const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
  const params = { ...(((next.source as unknown as AnySource).params as Record<string, unknown> | null | undefined) ?? {}) };
  if (value === undefined) delete params[key];
  else params[key] = value;
  (next.source as unknown as AnySource).params = Object.keys(params).length > 0 ? params : null;
  return next;
}

// ── DOM-tier sources (RFC §10: table + pivot) ───────────────────────────────────────
//
// Both persist display state only — columnFormats and the css override (looks are CSS
// against the stable .mx-* class contract; behavior/chrome are per-surface); pivot
// additionally persists its typed STRUCTURE (PivotConfig). All setters are surgical
// envelope edits; no-ops on sources of a different kind.

const isDomTierSource = (envelope: VizEnvelope): boolean => {
  const kind = sourceOf(envelope).kind;
  return kind === 'table' || kind === 'pivot';
};
const isTableSource = (envelope: VizEnvelope): boolean => sourceOf(envelope).kind === 'table';
const isPivotSource = (envelope: VizEnvelope): boolean => sourceOf(envelope).kind === 'pivot';
// columnFormats live on the DOM-tier sources AND recipes (applied at materialization —
// aliases rename column-name-derived displays, number configs reshape value labels).
const isFormatBearingSource = (envelope: VizEnvelope): boolean =>
  isDomTierSource(envelope) || sourceOf(envelope).kind === 'recipe';

export function getVizColumnFormats(envelope: VizEnvelope): Record<string, ColumnFormatConfig> {
  if (!isFormatBearingSource(envelope)) return {};
  return (sourceOf(envelope).columnFormats as Record<string, ColumnFormatConfig> | null | undefined) ?? {};
}

export function setVizColumnFormats(envelope: VizEnvelope, formats: Record<string, ColumnFormatConfig>): VizEnvelope {
  if (!isFormatBearingSource(envelope)) return envelope;
  const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
  (next.source as unknown as AnySource).columnFormats = Object.keys(formats).length > 0 ? formats : null;
  return next;
}

const isEmptyFormat = (cfg: ColumnFormatConfig): boolean =>
  !cfg.alias && !cfg.format && cfg.decimalPoints == null && !cfg.dateFormat && !cfg.prefix && !cfg.suffix;

/** Upsert one column's format (an emptied config removes the key — TableV2 semantics). */
export function mergeVizColumnFormat(envelope: VizEnvelope, column: string, config: ColumnFormatConfig): VizEnvelope {
  const formats = { ...getVizColumnFormats(envelope) };
  if (isEmptyFormat(config)) delete formats[column];
  else formats[column] = config;
  return setVizColumnFormats(envelope, formats);
}

export function getTableConditionalFormats(envelope: VizEnvelope): ConditionalFormatRule[] {
  if (!isDomTierSource(envelope)) return [];
  return (sourceOf(envelope).conditionalFormats as ConditionalFormatRule[] | null | undefined) ?? [];
}

export function setTableConditionalFormats(envelope: VizEnvelope, rules: ConditionalFormatRule[]): VizEnvelope {
  if (!isDomTierSource(envelope)) return envelope;
  const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
  (next.source as unknown as AnySource).conditionalFormats = rules.length > 0 ? rules : null;
  return next;
}

export function getVizCss(envelope: VizEnvelope): string | null {
  if (!isDomTierSource(envelope)) return null;
  return (sourceOf(envelope).css as string | null | undefined) ?? null;
}

export function setVizCss(envelope: VizEnvelope, css: string): VizEnvelope {
  if (!isDomTierSource(envelope)) return envelope;
  const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
  (next.source as unknown as AnySource).css = css.trim() === '' ? null : css;
  return next;
}

export function getPivotConfig(envelope: VizEnvelope): PivotConfig | null {
  if (!isPivotSource(envelope)) return null;
  return (sourceOf(envelope).config as PivotConfig | undefined) ?? null;
}

export function setPivotConfig(envelope: VizEnvelope, config: PivotConfig): VizEnvelope {
  if (!isPivotSource(envelope)) return envelope;
  const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
  (next.source as unknown as AnySource).config = config;
  return next;
}

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
  const transforms = unitOrSelf(spec).transform;
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
  const { next, spec: outerSpec } = cloneEnvelope(envelope);
  const spec = unitOrSelf(outerSpec);
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
  // Suppress the axis title: a single title over multiple folded measures is meaningless,
  // and without this Vega-Lite auto-labels the axis "Sum of __mx_value" (the internal field
  // name leaks). The measures are named by the color legend instead.
  encoding.y = { ...y, field: '__mx_value', type: 'quantitative', title: null };
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
  const { next, spec: outerSpec } = cloneEnvelope(envelope);
  const spec = unitOrSelf(outerSpec);
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
    const restored: Record<string, unknown> = { ...(encoding.y ?? {}), field: remaining, type: 'quantitative' };
    // The fold suppressed the axis title (title:null); a lone measure should auto-title again.
    if (restored.title === null) delete restored.title;
    encoding.y = restored;
  } else {
    delete encoding.y;
  }
  if (encoding.color?.field === fold.as[0]) delete encoding.color;
  spec.encoding = encoding;
  return next;
}

// ── Reference lines (annotations as REAL layers — no sidecar config) ────────────────
//
// The idiomatic Vega-Lite annotation is a layered rule, plus a BADGE label (a tinted
// rect plate behind colored text — the house chip look, readable in both color modes).
// Written straight into source.spec: the spec is the single source of truth, and the
// annotated shape stays recognized (annotationSplit) so the panel keeps working.

export interface ReferenceLineSpec {
  axis: 'x' | 'y';
  value: number | string;
  label?: string | null;
  color?: string | null;
}

const REFERENCE_LINE_DEFAULT_COLOR = '#e74c3c';

/** Convert a date-ish value to VL's DateTime object — raw string datums don't reliably
 *  parse on temporal scales. UTC fields: result dates are UTC/date-only. */
const toDateTimeDatum = (value: number | string): Record<string, number> | null => {
  const d = new Date(value);
  if (Number.isNaN(+d)) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate() };
};

// Badge geometry (probed empirically): rect mark-prop x/y anchor the CENTER; text
// mark-prop x is the align anchor. Mono at 11px ≈ 6.6px/char (LEGEND_LABEL_CHAR_PX).
const BADGE_CHAR_PX = 6.6;
const BADGE_PAD_PX = 7;
const BADGE_HEIGHT_PX = 18;
const BADGE_EDGE_PX = 8;   // inset from the plot edge
const BADGE_LIFT_PX = 13;  // vertical distance from the rule to the badge center (y-lines)

/**
 * The badge layers for a reference-line label: an OPAQUE surface backing (the
 * `mx-annotation-plate` theme style supplies the mode-aware surface fill, like the
 * trend recipe's `mx-trend-focus` plate) under a tinted color plate, under the text —
 * so the badge stays readable over gridlines and data in both color modes.
 */
function badgeLayers(
  axis: 'x' | 'y',
  anchor: Record<string, unknown>,
  label: string,
  color: string,
): Record<string, unknown>[] {
  const width = Math.round(label.length * BADGE_CHAR_PX) + BADGE_PAD_PX * 2;
  const plateMark = axis === 'y'
    ? { x: BADGE_EDGE_PX + width / 2, yOffset: -BADGE_LIFT_PX }
    : { y: BADGE_EDGE_PX + BADGE_HEIGHT_PX / 2, xOffset: BADGE_EDGE_PX / 2 + width / 2 };
  const textMark = axis === 'y'
    ? { x: BADGE_EDGE_PX + BADGE_PAD_PX, dy: -BADGE_LIFT_PX }
    : { y: BADGE_EDGE_PX + BADGE_HEIGHT_PX / 2, dx: BADGE_EDGE_PX / 2 + BADGE_PAD_PX };
  const plateGeometry = { ...plateMark, width, height: BADGE_HEIGHT_PX, cornerRadius: 5 };
  return [
    {
      transform: [{ sample: 1 }],
      // No fill here — the theme style provides the surface color per color mode.
      mark: { type: 'rect', style: 'mx-annotation-plate', ...plateGeometry },
      encoding: { ...anchor },
    },
    {
      transform: [{ sample: 1 }],
      mark: { type: 'rect', ...plateGeometry, fill: color, fillOpacity: 0.16 },
      encoding: { ...anchor },
    },
    {
      transform: [{ sample: 1 }],
      mark: { type: 'text', ...textMark, align: 'left', baseline: 'middle', fontWeight: 'bold', color },
      encoding: { ...anchor, text: { value: label } },
    },
  ];
}

/** Append a reference line (rule + optional badge label) as real layers. Unit specs are
 *  wrapped into `{layer: [unit, …]}`; already-layered specs get the layers appended. */
export function addReferenceLine(envelope: VizEnvelope, line: ReferenceLineSpec): VizEnvelope {
  const source = sourceOf(envelope);
  if (source.kind !== 'vega-lite') return envelope;
  const { next, spec } = cloneEnvelope(envelope);

  // The anchored channel's type (temporal x needs a DateTime datum). Read from the
  // unit spec, or the first layer of a composed one.
  const base = isUnitVegaLiteSpec(spec) ? spec : (Array.isArray(spec.layer) ? (spec.layer[0] as Record<string, unknown>) : null);
  const channelType = base ? (channelDef(base, line.axis)?.type as string | undefined) : undefined;
  const datum = channelType === 'temporal' ? (toDateTimeDatum(line.value) ?? line.value) : line.value;

  const color = line.color || REFERENCE_LINE_DEFAULT_COLOR;
  const anchor = { [line.axis]: { datum } };
  const layers: Record<string, unknown>[] = [{
    // sample(1): annotation layers inherit the full dataset and would otherwise draw
    // one mark PER ROW (stacked plates/text at row count × opacity).
    transform: [{ sample: 1 }],
    mark: { type: 'rule', color, strokeDash: [4, 4], strokeWidth: 1.5 },
    encoding: anchor,
  }];
  if (line.label != null && line.label !== '') {
    layers.push(...badgeLayers(line.axis, anchor, line.label, color));
  }

  if (Array.isArray(spec.layer)) {
    spec.layer = [...(spec.layer as unknown[]), ...layers];
    return next;
  }
  // Wrap the unit spec: it becomes the base layer WHOLESALE (including its transform,
  // so folds stay unit-scoped and the annotated-unit editors keep finding them).
  const wrapped: Record<string, unknown> = {};
  const baseLayer: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (k === '$schema') wrapped[k] = v;
    else baseLayer[k] = v;
    delete spec[k];
  }
  Object.assign(spec, wrapped, { layer: [baseLayer, ...layers] });
  return next;
}

// ── Reference-line management (list / recolor / remove, unwrap on last) ─────────────

export interface ReferenceLineEntry {
  /** The rule layer's index in spec.layer — the stable handle for edits. */
  index: number;
  axis: 'x' | 'y';
  /** Display value (DateTime datums read back as YYYY-MM-DD). */
  value: number | string;
  label: string | null;
  color: string;
}

const datumDisplay = (datum: unknown): number | string => {
  const d = asPlainRecord(datum);
  if (d && typeof d.year === 'number') {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.year}-${pad((d.month as number) ?? 1)}-${pad((d.date as number) ?? 1)}`;
  }
  return datum as number | string;
};

/** A rule layer + its trailing badge layers (everything up to the next rule). */
function referenceLineGroups(spec: Record<string, unknown>): Array<{ start: number; end: number; rule: Record<string, unknown>; text: Record<string, unknown> | null }> {
  const split = annotationSplit(spec);
  if (!split || split.annotations.length === 0) return [];
  const layers = spec.layer as unknown[];
  const groups: Array<{ start: number; end: number; rule: Record<string, unknown>; text: Record<string, unknown> | null }> = [];
  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i] as Record<string, unknown>;
    if (getMarkType(layer) !== 'rule') continue;
    let end = i + 1;
    while (end < layers.length && getMarkType(layers[end] as Record<string, unknown>) !== 'rule') end++;
    const text = (layers.slice(i + 1, end) as Record<string, unknown>[]).find(l => getMarkType(l) === 'text') ?? null;
    groups.push({ start: i, end, rule: layer, text });
  }
  return groups;
}

export function getReferenceLines(envelope: VizEnvelope): ReferenceLineEntry[] {
  const source = sourceOf(envelope);
  if (source.kind !== 'vega-lite') return [];
  const spec = (source as { spec: Record<string, unknown> }).spec;
  return referenceLineGroups(spec).map(({ start, rule, text }) => {
    const encoding = (rule.encoding ?? {}) as Record<string, { datum?: unknown } | undefined>;
    const axis: 'x' | 'y' = encoding.y?.datum !== undefined ? 'y' : 'x';
    const mark = asPlainRecord(rule.mark);
    const textValue = (asPlainRecord((text?.encoding as Record<string, unknown> | undefined)?.text)?.value ?? null) as string | null;
    return {
      index: start,
      axis,
      value: datumDisplay(encoding[axis]?.datum),
      label: textValue,
      color: typeof mark?.color === 'string' ? mark.color : REFERENCE_LINE_DEFAULT_COLOR,
    };
  });
}

/** Recolor one reference line (rule + tint plate + text move together; the surface
 *  BACKING plate keeps its theme fill). */
export function setReferenceLineColor(envelope: VizEnvelope, index: number, color: string): VizEnvelope {
  const source = sourceOf(envelope);
  if (source.kind !== 'vega-lite') return envelope;
  const { next, spec } = cloneEnvelope(envelope);
  const group = referenceLineGroups(spec).find(g => g.start === index);
  if (!group) return envelope;
  const layers = spec.layer as Record<string, unknown>[];
  for (let i = group.start; i < group.end; i++) {
    const mark = asPlainRecord(layers[i].mark);
    if (!mark || mark.style === 'mx-annotation-plate') continue;
    if (getMarkType(layers[i]) === 'rect') mark.fill = color;
    else mark.color = color;
  }
  return next;
}

/** Remove one reference line; removing the LAST unwraps back to the plain unit spec. */
export function removeReferenceLine(envelope: VizEnvelope, index: number): VizEnvelope {
  const source = sourceOf(envelope);
  if (source.kind !== 'vega-lite') return envelope;
  const { next, spec } = cloneEnvelope(envelope);
  const group = referenceLineGroups(spec).find(g => g.start === index);
  if (!group) return envelope;
  const layers = (spec.layer as unknown[]).filter((_, i) => i < group.start || i >= group.end);
  if (layers.length === 1) {
    // Only the base chart remains — hoist it back to a unit spec.
    const base = layers[0] as Record<string, unknown>;
    delete spec.layer;
    Object.assign(spec, base);
    return next;
  }
  spec.layer = layers;
  return next;
}

// ── Series colors (the V1 Style-popover colors, spec-native) ────────────────────────
//
// Overrides are keyed by SERIES NAME and written into the color channel's scale
// (domain + range) — never an index-keyed side-channel — so they survive data
// reordering and detach, agents see them in the spec, and defaults stay stable
// (the full domain is pinned alongside the range).

export interface SeriesColorEntry {
  key: string;
  /** Effective color: the override, or the default palette color at the domain position. */
  color: string;
  overridden: boolean;
}

/** The chart's series keys in VEGA's default domain order (ascending strings). */
function seriesKeys(spec: Record<string, unknown>, rows: Array<Record<string, unknown>>): string[] {
  const color = channelDef(spec, 'color');
  const y = channelDef(spec, 'y');
  if (color && typeof color.field === 'string') {
    // Fold key → the folded measure columns are the series.
    const fold = typeof y?.field === 'string' ? findYFold(spec) : null;
    if (fold && fold.as[0] === color.field) return [...fold.fields].sort();
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row[color.field];
      if (v != null) seen.add(String(v));
    }
    return [...seen].sort();
  }
  if (color && typeof color.datum === 'string') return [color.datum];
  // Single measure: the injected render-time legend names the series after the measure.
  if (y && typeof y.field === 'string') return [typeof y.title === 'string' ? y.title : y.field];
  return [];
}

/**
 * Overrides currently pinned on the color scale (domain[i] → range[i]). Writing pins the
 * FULL domain+range (order-stable), so entries that still equal the default palette color
 * at their position are NOT user overrides — they read back as defaults.
 */
function seriesColorOverrides(spec: Record<string, unknown>): Map<string, string> {
  const scale = asPlainRecord(channelDef(spec, 'color')?.scale);
  const domain = scale?.domain;
  const range = scale?.range;
  const out = new Map<string, string>();
  if (Array.isArray(domain) && Array.isArray(range)) {
    domain.forEach((k, i) => {
      const c = range[i];
      if (typeof c === 'string' && c !== COLOR_PALETTE[i % COLOR_PALETTE.length]) out.set(String(k), c);
    });
  } else if (Array.isArray(range) && range.length === 1 && typeof range[0] === 'string') {
    // Single-series datum legend: a one-entry range with no domain.
    const key = seriesKeys(spec, [])[0];
    if (key) out.set(key, range[0]);
  }
  return out;
}

const asPlainRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** The series list with effective colors, for the Settings UI. */
export function getSeriesColors(envelope: VizEnvelope, rows: Array<Record<string, unknown>>): SeriesColorEntry[] {
  const source = sourceOf(envelope);
  if (source.kind !== 'vega-lite') return [];
  const spec = (source as { spec: Record<string, unknown> }).spec;
  if (unitOf(spec) == null) return [];
  const overrides = seriesColorOverrides(spec);
  return seriesKeys(spec, rows).map((key, i) => ({
    key,
    color: overrides.get(key) ?? COLOR_PALETTE[i % COLOR_PALETTE.length],
    overridden: overrides.has(key),
  }));
}

/** Set (hex) or clear (null) one series' color. Surgical; no-op on non-unit/non-VL sources. */
export function setSeriesColor(
  envelope: VizEnvelope,
  rows: Array<Record<string, unknown>>,
  seriesKey: string,
  color: string | null,
): VizEnvelope {
  const source = sourceOf(envelope);
  if (source.kind !== 'vega-lite') return envelope;
  if (unitOf((source as { spec: Record<string, unknown> }).spec) == null) return envelope;
  const { next, spec: outerSpec } = cloneEnvelope(envelope);
  const spec = unitOrSelf(outerSpec);
  const encoding = (spec.encoding ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const keys = seriesKeys(spec, rows);
  const overrides = seriesColorOverrides(spec);
  if (color == null) overrides.delete(seriesKey);
  else overrides.set(seriesKey, color);

  const colorDef = encoding.color;
  const fieldBased = colorDef != null && typeof colorDef.field === 'string';

  if (!fieldBased) {
    // Single measure: persist a datum legend + one-entry range (what the render-time
    // injection produces, plus the pinned color); clearing restores the bare spec.
    if (overrides.size === 0) {
      delete encoding.color;
    } else {
      encoding.color = { datum: keys[0], scale: { range: [overrides.get(keys[0])!] } };
    }
    spec.encoding = encoding;
    return next;
  }

  const def = { ...colorDef } as Record<string, unknown>;
  const scale = { ...(asPlainRecord(def.scale) ?? {}) };
  if (overrides.size === 0) {
    delete scale.domain;
    delete scale.range;
  } else {
    scale.domain = keys;
    scale.range = keys.map((k, i) => overrides.get(k) ?? COLOR_PALETTE[i % COLOR_PALETTE.length]);
  }
  if (Object.keys(scale).length > 0) def.scale = scale;
  else delete def.scale;
  encoding.color = def;
  spec.encoding = encoding;
  return next;
}

// ── Channel presentation (the zone-chip settings popover) ──────────────────────────
//
// Alias and format are NATIVE spec properties (RFC §6): alias = the channel's
// `title`; format = a d3 pattern on `axis.format` for positional channels, or the
// field def's `format` where there is no axis (theta). Surgical edits only.

const AXIS_CHANNELS = immutableSet(['x', 'y']);

export interface ChannelPresentation {
  title: string | null;
  format: string | null;
}

export function getChannelPresentation(envelope: VizEnvelope, channel: string): ChannelPresentation {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') return { title: null, format: null };
  const spec = (source as { spec: Record<string, unknown> }).spec;
  const def = channelDef(spec, channel);
  if (!def) return { title: null, format: null };
  const axis = def.axis as Record<string, unknown> | undefined;
  let format: string | null;
  if (AXIS_CHANNELS.has(channel)) {
    format = typeof axis?.format === 'string' ? axis.format : null;
    // Discrete-axis date labels live in OUR labelExpr shape — read the pattern back.
    if (format == null && typeof axis?.labelExpr === 'string') {
      format = DISCRETE_DATE_LABEL_RE.exec(axis.labelExpr)?.[1] ?? null;
    }
  } else {
    format = typeof def.format === 'string' ? def.format : null;
  }
  return { title: typeof def.title === 'string' ? def.title : null, format };
}

/**
 * Discrete-axis date labels: the labelExpr our popover writes for a temporal COLUMN on
 * an ordinal/nominal band axis, and the regex that reads the pattern back. Why not
 * `axis.format`: ordinal axes treat `format` as a d3 NUMBER format — d3-format('%b %Y')
 * THROWS inside the vega dataflow (a silent blank chart). Why not `formatType`:
 * Vega-Lite DROPS 'utc' as a custom type, and 'time' formats locally, shifting a
 * '2024-01-01Z' band label back into "Dec 2023". utcFormat over toDate is exact.
 */
// The pattern rides in a DOUBLE-quoted expression string so date patterns with
// apostrophes ("%b '%y" → Jan '25) survive; double quotes are stripped (never valid
// in a d3 date pattern, and they'd break out of the expression).
const discreteDateLabelExpr = (fmt: string): string =>
  `utcFormat(toDate(datum.value), "${fmt.replace(/"/g, '')}")`;
const DISCRETE_DATE_LABEL_RE = /^utcFormat\(toDate\(datum\.value\), "(.+)"\)$/;

/**
 * Set/clear (null) the alias and/or format on one channel. `undefined` leaves as-is.
 * `opts.temporalKind` marks the underlying COLUMN as a date: on a channel rendered
 * DISCRETE (the heatmap's temporal→ordinal band axis) the date pattern is written as a
 * UTC labelExpr (see above). True temporal channels keep plain `axis.format` — VL
 * time-formats those natively.
 */
export function setChannelPresentation(
  envelope: VizEnvelope,
  channel: string,
  changes: { title?: string | null; format?: string | null },
  opts?: { temporalKind?: boolean },
): VizEnvelope {
  const source = sourceOf(envelope);
  if (source.kind === 'recipe') return envelope; // recipes format internally
  const { next, spec } = cloneEnvelope(envelope);
  const def = channelDef(spec, channel);
  if (!def) return next;

  if (changes.title !== undefined) {
    if (changes.title === null || changes.title === '') delete def.title;
    else def.title = changes.title;
  }

  if (changes.format !== undefined) {
    const discreteDateAxis = opts?.temporalKind === true && def.type !== 'temporal';
    if (AXIS_CHANNELS.has(channel)) {
      const axis = { ...((def.axis as Record<string, unknown> | undefined) ?? {}) };
      // Clear BOTH representations first — the channel may have flipped between
      // continuous (format) and discrete (labelExpr) since the format was set.
      delete axis.format;
      if (typeof axis.labelExpr === 'string' && DISCRETE_DATE_LABEL_RE.test(axis.labelExpr)) delete axis.labelExpr;
      if (changes.format != null && changes.format !== '') {
        if (discreteDateAxis) axis.labelExpr = discreteDateLabelExpr(changes.format);
        else axis.format = changes.format;
      }
      if (Object.keys(axis).length > 0) def.axis = axis;
      else delete def.axis;
    } else {
      if (changes.format === null || changes.format === '') delete def.format;
      else def.format = changes.format;
    }
  }
  return next;
}
