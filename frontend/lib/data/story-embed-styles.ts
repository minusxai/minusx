/**
 * Saved-embed styles codec — `<Question id={N} styles={{…}}/>` persists its style override as a
 * `data-question-styles` JSON attribute on the placeholder div (the same pattern as the inline
 * `data-question-inline` payload). Only the presentation subset (EmbedVizStyles) is kept: a
 * styles prop restyles the chart; it can never change what the question plots.
 */
import type { EmbedVizStyles } from '@/lib/validation/atlas-schemas';
import { parseJsonAttr, serializeJsonAttr } from './html-attr';

export const EMBED_STYLES_ATTR = 'data-question-styles';

export const EMBED_STYLE_KEYS = [
  'styleConfig', 'axisConfig', 'columnFormats', 'conditionalFormats', 'singleValueConfig',
] as const;

/** Pick the presentation-only subset out of a jsx `styles={{…}}` attr value (or any parsed JSON). */
export function embedStylesFromJsxAttr(v: unknown): EmbedVizStyles | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const source = v as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of EMBED_STYLE_KEYS) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return Object.keys(picked).length ? (picked as EmbedVizStyles) : null;
}

/** Serialize for placement inside the placeholder's HTML attribute (entity-escaped JSON). */
export function embedStylesToAttr(styles: EmbedVizStyles): string {
  return serializeJsonAttr(styles);
}

/** Read the styles back off a placeholder element (DOM getAttribute or regex-extracted). */
export function embedStylesFromEl(el: { getAttribute(name: string): string | null }): EmbedVizStyles | null {
  const parsed = parseJsonAttr<unknown>(el.getAttribute(EMBED_STYLES_ATTR));
  return parsed == null ? null : embedStylesFromJsxAttr(parsed);
}
