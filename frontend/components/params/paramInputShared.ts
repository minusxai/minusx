// Shared constants/helpers used across the ParameterInput sub-components
// (ParameterInput.tsx, SourceDropdownWidget.tsx, InlineSqlDropdownWidget.tsx, SourceConfigPopover.tsx).

export const ROW_H = '32px';

// Format a number string to max 2 decimal places, removing trailing zeros
export function formatNumStr(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return String(parseFloat(n.toFixed(2)));
}
