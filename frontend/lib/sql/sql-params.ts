import { QuestionParameter } from '../types';

/**
 * Extract parameter names from SQL query using :param_name syntax.
 *
 * Uses the same regex as SQLAlchemy's TextClause._bind_params_regex:
 * https://github.com/sqlalchemy/sqlalchemy/blob/0138954e28096199a3b2fd8553183a599c83cdab/lib/sqlalchemy/sql/elements.py#L2571C5-L2571C23
 *
 * Negative lookbehind (?<![:\w\\]) skips :: type casts, word-char-preceded colons
 * (e.g. digits in '10:30:00'), and \: escaped colons.
 * Negative lookahead (?!:) skips the left side of :: type casts.
 *
 * Limitation: does not skip :param inside string literals or SQL comments.
 * Use \:name to prevent a colon from being treated as a parameter.
 */
export function extractParametersFromSQL(sql: string): string[] {
  if (!sql) return [];
  const regex = /(?<![:\w\\]):([a-zA-Z_]\w*)(?!:)/gu;
  const paramNames = new Set<string>();
  for (const match of sql.matchAll(regex)) {
    paramNames.add(match[1]);
  }
  return Array.from(paramNames);
}

/**
 * An empty string is meaningless for a **number** param — engines can't cast `''` to a number,
 * and the agent's `(:p IS NULL OR … >= :p)` guards expect `null` to mean "no filter". So `''`
 * for a number param is None. Text `''` is a real value; `null` (Set to None) is preserved.
 */
const isEmptyNumeric = (v: unknown, type: string | undefined): boolean => v === '' && type === 'number';

/** name → declared type map, for the chokepoint coercion (`getQueryResult`'s `parameterTypes`). */
export function paramTypeMap(params: QuestionParameter[] | undefined): Record<string, 'text' | 'number' | 'date'> {
  const m: Record<string, 'text' | 'number' | 'date'> = {};
  for (const p of params ?? []) m[p.name] = p.type;
  return m;
}

/**
 * The single coercion (used at the `getQueryResult` chokepoint): map an empty-string value of a
 * number-typed param to None (`null`), preserving every other value. Pure; no-ops without types.
 */
export function noneifyEmptyNumericParams(
  values: Record<string, unknown>,
  types: Record<string, 'text' | 'number' | 'date'> | undefined,
): Record<string, unknown> {
  if (!values || !types) return values ?? {};
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (isEmptyNumeric(v, types[k])) { out[k] = null; changed = true; } else out[k] = v;
  }
  return changed ? out : values;
}

/**
 * Assemble the values dict to execute a question with, from its declared params and the
 * available value sources (explicit external values from a dashboard/story take precedence
 * over the question's own saved values). A missing number param defaults to None, a missing
 * text param to `''`; empty-numeric → None is applied via the shared rule.
 */
export function buildQueryParamValues(
  params: QuestionParameter[],
  ownValues: Record<string, unknown> | undefined,
  externalValues: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) {
    let v: unknown = externalValues && p.name in externalValues ? externalValues[p.name] : ownValues?.[p.name];
    if (v === undefined) v = p.type === 'number' ? null : '';
    if (isEmptyNumeric(v, p.type)) v = null;
    out[p.name] = v;
  }
  return out;
}

/**
 * Bind the story param values a raw query actually references. Used for inline `<Number query>`
 * embeds, which (unlike `<Question>`) declare no `parameters` list — so we derive the referenced
 * `:names` straight from the SQL and pull each one's value from the param-value map (a missing
 * one → `null`, i.e. None / "no filter").
 *
 * Type-agnostic on purpose: the renderer and the server/client augmentation must produce the
 * IDENTICAL params object so their query hashes line up, and the renderer only has values (not
 * declared types). So it depends solely on (query, values).
 */
export function bindReferencedParams(
  query: string | undefined,
  values: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const vals = values ?? {};
  for (const name of extractParametersFromSQL(query ?? '')) {
    out[name] = name in vals ? vals[name] : null;
  }
  return out;
}

/** Infer a parameter's type from its name (internal — used by syncParametersWithSQL). */
function inferParameterType(paramName: string): 'text' | 'number' | 'date' {
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

/** snake_case → Title Case label (used by syncParametersWithSQL and as a placeholder hint). */
export function generateLabel(paramName: string): string {
  return paramName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Resolve the human-facing display name for a parameter: the user-set `label`
 * if present, otherwise an auto-generated Title Case label from the SQL name
 * (e.g. `start_date` → "Start Date"). The raw `name` remains the SQL binding.
 */
export function getParameterDisplayName(parameter: QuestionParameter): string {
  const custom = parameter.label?.trim();
  return custom || generateLabel(parameter.name);
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
