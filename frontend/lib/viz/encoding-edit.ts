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

export const V2_SUPPORTED_VIZ_TYPES = ['table', 'pivot', 'bar', 'line', 'area', 'scatter', 'pie', 'row', 'funnel', 'waterfall', 'radar'] as const;
export type V2VizType = (typeof V2_SUPPORTED_VIZ_TYPES)[number];

const MARK_FOR_TYPE: Record<Exclude<V2VizType, 'table' | 'pivot' | 'row' | 'pie' | 'funnel' | 'waterfall' | 'radar'>, string> = {
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

/** Native-spec viz types (recipes and the DOM table route through setEnvelopeVizType instead). */
export type SpecVizType = Exclude<V2VizType, 'table' | 'pivot' | 'funnel' | 'waterfall' | 'radar'>;

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
    // Minimal mark only — the house donut styling (responsive innerRadius, rounded,
    // padded) is the theme's config.arc, so this saved spec stays identical to what
    // an agent authors and both render the same.
    withMark(spec, 'arc');
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
  if (source.kind === 'table') return 'table';
  if (source.kind === 'pivot') return 'pivot';
  if (source.kind === 'recipe') {
    return getTemplate(source.recipe as string)?.vizType ?? null;
  }
  return getVizType((source as { spec: Record<string, unknown> }).spec);
}

export function isEnvelopeEditable(envelope: VizEnvelope): boolean {
  const source = sourceOf(envelope);
  if (source.kind === 'table' || source.kind === 'pivot') return true;
  if (source.kind === 'recipe') return getTemplate(source.recipe as string) != null;
  return isUnitVegaLiteSpec((source as { spec: Record<string, unknown> }).spec);
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
  return channel === 'y' && isUnitVegaLiteSpec((source as { spec: Record<string, unknown> }).spec);
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
  if (source.kind === 'recipe' || source.kind === 'table' || source.kind === 'pivot') {
    // Reconstruct a plain bar from the bindings/columns, then transform to the target.
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
  !cfg.alias && cfg.decimalPoints == null && !cfg.dateFormat && !cfg.prefix && !cfg.suffix;

/** Upsert one column's format (an emptied config removes the key — TableV2 semantics). */
export function mergeVizColumnFormat(envelope: VizEnvelope, column: string, config: ColumnFormatConfig): VizEnvelope {
  const formats = { ...getVizColumnFormats(envelope) };
  if (isEmptyFormat(config)) delete formats[column];
  else formats[column] = config;
  return setVizColumnFormats(envelope, formats);
}

export function getTableConditionalFormats(envelope: VizEnvelope): ConditionalFormatRule[] {
  if (!isTableSource(envelope)) return [];
  return (sourceOf(envelope).conditionalFormats as ConditionalFormatRule[] | null | undefined) ?? [];
}

export function setTableConditionalFormats(envelope: VizEnvelope, rules: ConditionalFormatRule[]): VizEnvelope {
  if (!isTableSource(envelope)) return envelope;
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
  const format = AXIS_CHANNELS.has(channel)
    ? (typeof axis?.format === 'string' ? axis.format : null)
    : (typeof def.format === 'string' ? def.format : null);
  return { title: typeof def.title === 'string' ? def.title : null, format };
}

/** Set/clear (null) the alias and/or format on one channel. `undefined` leaves as-is. */
export function setChannelPresentation(
  envelope: VizEnvelope,
  channel: string,
  changes: { title?: string | null; format?: string | null },
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
    if (AXIS_CHANNELS.has(channel)) {
      const axis = { ...((def.axis as Record<string, unknown> | undefined) ?? {}) };
      if (changes.format === null || changes.format === '') delete axis.format;
      else axis.format = changes.format;
      if (Object.keys(axis).length > 0) def.axis = axis;
      else delete def.axis;
    } else {
      if (changes.format === null || changes.format === '') delete def.format;
      else def.format = changes.format;
    }
  }
  return next;
}
