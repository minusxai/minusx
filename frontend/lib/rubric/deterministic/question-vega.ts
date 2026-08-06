/** Vega-backed deterministic checks for question visualizations. */
import type { QuestionContent } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { vizSettingsToEnvelopeStatic } from '@/lib/viz/from-vizsettings';
import { materializeRecipe } from '@/lib/viz/viz-templates';
import { immutableSet } from '@/lib/utils/immutable-collections';

type Obj = Record<string, unknown>;

const AXIS_VIZ_TYPES = immutableSet([
  'bar', 'row', 'line', 'area', 'scatter', 'combo', 'waterfall', 'heatmap', 'boxplot', 'histogram',
]);

const object = (value: unknown): Obj | null =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : null;

/** Resolve the authoritative V2 envelope, converting V1 only when the file has no V2 `viz`. */
function effectiveEnvelope(content: QuestionContent): VizEnvelope | undefined {
  if (content.viz) return content.viz;
  return content.vizSettings
    ? vizSettingsToEnvelopeStatic(content.vizSettings, content.query)
    : undefined;
}

/** Return a Vega-Lite spec when the envelope is statically inspectable. Native Vega is skipped. */
export function questionVegaLiteSpec(content: QuestionContent): Obj | undefined {
  const envelope = effectiveEnvelope(content);
  if (!envelope) return undefined;
  const source = envelope.source;
  if (source.kind === 'vega-lite') return object(source.spec) ?? undefined;
  if (source.kind !== 'recipe') return undefined;
  const resolved = materializeRecipe(source);
  return resolved.ok && resolved.engine === 'vega-lite' ? resolved.spec : undefined;
}

interface UnitSpec {
  mark: string;
  encoding: Obj;
}

function markType(spec: Obj): string | undefined {
  if (typeof spec.mark === 'string') return spec.mark;
  const mark = object(spec.mark);
  return typeof mark?.type === 'string' ? mark.type : undefined;
}

/** Flatten unit marks out of layer/facet/concat specs while inheriting parent encodings. */
function unitSpecs(spec: Obj, inheritedEncoding: Obj = {}, out: UnitSpec[] = []): UnitSpec[] {
  const encoding = { ...inheritedEncoding, ...(object(spec.encoding) ?? {}) };
  const mark = markType(spec);
  if (mark) out.push({ mark, encoding });

  const layer = Array.isArray(spec.layer) ? spec.layer : [];
  for (const child of layer) {
    const childSpec = object(child);
    if (childSpec) unitSpecs(childSpec, encoding, out);
  }
  for (const key of ['hconcat', 'vconcat', 'concat'] as const) {
    const children = Array.isArray(spec[key]) ? spec[key] : [];
    for (const child of children) {
      const childSpec = object(child);
      if (childSpec) unitSpecs(childSpec, encoding, out);
    }
  }
  const nested = object(spec.spec);
  if (nested) unitSpecs(nested, encoding, out);
  return out;
}

function hasUsableAxis(def: Obj): boolean {
  if (def.axis === null) return false;
  if (def.title === null || (typeof def.title === 'string' && def.title.trim() === '')) return false;
  const axis = object(def.axis);
  if (!axis) return true; // Vega-Lite derives a visible title from the field.
  if (axis.labels === false) return false;
  if (axis.title === null || (typeof axis.title === 'string' && axis.title.trim() === '')) return false;
  return true;
}

/** Explain positional fields whose axis labels/title are explicitly suppressed. */
export function unlabeledAxesDetail(spec: Obj, vizType: string | null | undefined): string | undefined {
  if (!vizType || !AXIS_VIZ_TYPES.has(vizType)) return undefined;
  const visibility = new Map<string, boolean>();
  for (const unit of unitSpecs(spec)) {
    for (const channel of ['x', 'y'] as const) {
      const def = object(unit.encoding[channel]);
      if (!def || typeof def.field !== 'string') continue;
      const key = `${channel}:${def.field}`;
      visibility.set(key, (visibility.get(key) ?? false) || hasUsableAxis(def));
    }
  }
  const hidden = [...visibility.entries()].find(([, visible]) => !visible)?.[0];
  if (!hidden) return undefined;
  const [channel, field] = hidden.split(':', 2);
  return `The ${channel}-axis for “${field}” suppresses its title or tick labels.`;
}
