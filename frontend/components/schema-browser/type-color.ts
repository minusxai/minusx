/**
 * The accent color for a SQL column type — shared by the table tree
 * (SchemaTreeSchemaRow) and the views section (ViewsSection) so a column's type
 * renders identically wherever it appears. Extracted verbatim from
 * SchemaTreeView so reuse can't drift the table rendering.
 */
export function getTypeColor(type: string): string {
  const typeLower = type.toLowerCase();
  if (typeLower.includes('int') || typeLower.includes('number') || typeLower.includes('decimal') || typeLower.includes('float')) {
    return 'accent.teal';
  }
  if (typeLower.includes('varchar') || typeLower.includes('text') || typeLower.includes('char') || typeLower.includes('string')) {
    return 'accent.primary';
  }
  if (typeLower.includes('date') || typeLower.includes('time') || typeLower.includes('timestamp')) {
    return 'accent.secondary';
  }
  if (typeLower.includes('bool')) {
    return 'accent.success';
  }
  return 'fg.muted';
}
