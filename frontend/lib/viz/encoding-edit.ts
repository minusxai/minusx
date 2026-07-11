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

export const EDITABLE_CHANNELS = ['x', 'y', 'color'] as const;
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
