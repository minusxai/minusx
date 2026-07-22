/**
 * UI display helpers for a parameter's type (icon + semantic color). Kept OUT of `sql-params.ts`
 * so that pure/server/test code can import the param logic without pulling React (`react-icons`).
 */
import { LuType, LuHash, LuCalendar } from 'react-icons/lu';
import type { IconType } from 'react-icons/lib';
import type { ParameterType } from '@/lib/validation/atlas-schemas';

/** Icon component for a parameter type. */
export function getTypeIcon(type: ParameterType): IconType {
  switch (type) {
    case 'number': return LuHash;
    case 'date': return LuCalendar;
    case 'text':
    default: return LuType;
  }
}

/**
 * Concrete CSS color for a parameter type (matches the Table component's scheme). MUST stay a
 * raw hex: consumers interpolate it into plain CSS (`border-left`, `color-mix(...)`), where a
 * token name is invalid and silently drops the style.
 */
export function getTypeColor(type: ParameterType): string {
  switch (type) {
    case 'number': return '#2980b9';  // blue (accent.primary)
    case 'date': return '#9b59b6';    // purple (accent.secondary)
    case 'text':
    default: return '#f39c12';        // orange (accent.warning)
  }
}
