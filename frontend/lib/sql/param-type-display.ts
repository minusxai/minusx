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

/** Semantic color token for a parameter type (matches the Table component's scheme). */
export function getTypeColor(type: ParameterType): string {
  switch (type) {
    case 'number': return 'accent.primary';   // blue
    case 'date': return 'accent.secondary';    // purple
    case 'text':
    default: return 'accent.warning';          // orange
  }
}
