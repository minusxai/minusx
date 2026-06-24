/**
 * Pure display resolution for the single_value (big number) viz.
 *
 * The number is ALWAYS live — read from the query result and passed in as `item.value`.
 * `SingleValueConfig` only decorates it (label, prefix/suffix, typography). It can never
 * substitute a hand-written number; an absent value renders as an em-dash, undecorated.
 */
import { formatLargeNumber } from './chart-utils';
import type { SingleValueConfig } from '@/lib/validation/atlas-schemas';

export interface SingleValueItem {
  name: string;
  value: string | number | null;
}

export interface SingleValueDisplay {
  label: string;
  text: string;
  valueStyle: { fontSize?: string; color?: string; fontWeight?: number };
  labelStyle: { color?: string };
  align: 'left' | 'center' | 'right';
}

function formatRaw(value: string | number | null): { text: string; isValue: boolean } {
  if (value == null) return { text: '—', isValue: false };
  if (typeof value === 'number') return { text: formatLargeNumber(value), isValue: true };
  return { text: String(value), isValue: true };
}

export function resolveSingleValueDisplay(
  item: SingleValueItem,
  config?: SingleValueConfig | null,
): SingleValueDisplay {
  const { text: raw, isValue } = formatRaw(item.value);
  // Prefix/suffix only wrap an actual value — never decorate the "no data" em-dash.
  const text = isValue ? `${config?.prefix ?? ''}${raw}${config?.suffix ?? ''}` : raw;

  const valueStyle: SingleValueDisplay['valueStyle'] = {};
  if (config?.valueSize) valueStyle.fontSize = config.valueSize;
  if (config?.valueColor) valueStyle.color = config.valueColor;
  if (config?.valueWeight != null) valueStyle.fontWeight = config.valueWeight;

  const labelStyle: SingleValueDisplay['labelStyle'] = {};
  if (config?.labelColor) labelStyle.color = config.labelColor;

  return {
    // label override wins even when empty (''), so the agent can hide the label.
    label: config?.label != null ? config.label : item.name,
    text,
    valueStyle,
    labelStyle,
    align: config?.align ?? 'center',
  };
}
