import { QuestionParameter } from '../types';
import { LuType, LuHash, LuCalendar } from 'react-icons/lu';
import { IconType } from 'react-icons/lib';

/**
 * Extract parameter names from SQL query using :param_name syntax
 * Note: Ignores DuckDB type casts like ::VARCHAR (double colon)
 */
export function extractParametersFromSQL(sql: string): string[] {
  // Match :param_name pattern (word characters after colon)
  // Use negative lookbehind to exclude :: (type casts)
  if (!sql) {
    return []
  }
  const regex = /(?<!:):(\w+)/g;
  const matches = sql.matchAll(regex);
  const paramNames = new Set<string>();

  for (const match of matches) {
    paramNames.add(match[1]);
  }

  return Array.from(paramNames);
}

/**
 * Infer parameter type from parameter name
 */
export function inferParameterType(paramName: string): 'text' | 'number' | 'date' {
  const lowerName = paramName.toLowerCase();

  // Date patterns
  if (
    lowerName.endsWith('_date') ||
    lowerName.endsWith('_at') ||
    lowerName.includes('date') ||
    lowerName.includes('timestamp')
  ) {
    return 'date';
  }

  // Number patterns
  if (
    lowerName.endsWith('_id') ||
    lowerName.endsWith('_count') ||
    lowerName.endsWith('_amount') ||
    lowerName.endsWith('_num') ||
    lowerName.endsWith('_number') ||
    lowerName.includes('count') ||
    lowerName.includes('amount') ||
    lowerName.includes('price') ||
    lowerName.includes('total')
  ) {
    return 'number';
  }

  // Default to text
  return 'text';
}

/**
 * Generate label from parameter name (convert snake_case to Title Case)
 */
export function generateLabel(paramName: string): string {
  return paramName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get icon component for parameter/column type
 */
export function getTypeIcon(type: 'text' | 'number' | 'date'): IconType {
  switch (type) {
    case 'number':
      return LuHash;
    case 'date':
      return LuCalendar;
    case 'text':
    default:
      return LuType;
  }
}

/**
 * Get semantic color token for parameter/column type
 * Matches the color scheme used in Table component
 */
export function getTypeColor(type: 'text' | 'number' | 'date'): string {
  switch (type) {
    case 'number':
      return 'accent.primary'; // blue (#2980b9 - Belize Hole)
    case 'date':
      return 'accent.secondary'; // purple (#9b59b6 - Amethyst)
    case 'text':
    default:
      return 'accent.warning'; // orange (#f39c12)
  }
}

/**
 * Get hex color value for type (for use in charts/canvas)
 */
export function getTypeColorHex(type: 'text' | 'number' | 'date'): string {
  switch (type) {
    case 'number':
      return '#2980b9'; // Belize Hole (blue)
    case 'date':
      return '#9b59b6'; // Amethyst (purple)
    case 'text':
    default:
      return '#f39c12'; // Orange
  }
}

/**
 * Sync parameters with SQL query
 * - Add new parameters found in SQL
 * - Remove parameters not in SQL
 * - Keep existing parameter configurations
 */
export function syncParametersWithSQL(
  sql: string,
  currentParams: QuestionParameter[] = []
): QuestionParameter[] {
  const paramNamesInSQL = extractParametersFromSQL(sql);
  const safeCurrentParams = Array.isArray(currentParams) ? currentParams : [];
  const currentParamMap = new Map(safeCurrentParams.map((p) => [p.name, p]));

  // Build new parameter list
  const newParams: QuestionParameter[] = [];

  for (const paramName of paramNamesInSQL) {
    const existing = currentParamMap.get(paramName);
    if (existing) {
      // Keep existing parameter with its configuration
      newParams.push(existing);
    } else {
      // Create new parameter with inferred type
      newParams.push({
        name: paramName,
        type: inferParameterType(paramName),
        label: generateLabel(paramName),
      });
    }
  }

  return newParams;
}
