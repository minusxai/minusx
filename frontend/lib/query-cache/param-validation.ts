/**
 * Strict param validation for the public (guest) file-execution path.
 *
 * A guest sends `{fileId, params}`; the spec is derived from the file's declared
 * `parameters` (name+type). A caller may override ONLY params named in that
 * spec, each validated against its declared type (+ optional rules). Unknown
 * keys are rejected outright. The output is a clean `Record<name, value|null>`
 * the caller BINDS as query parameters — never string-concatenated into SQL.
 *
 * This is the security boundary for anonymous query access: the file's frozen
 * query runs with only allowlisted, type-checked, bound param values.
 */
import type { QueryParamSpec, ParamRule } from './types';

export class ParamValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParamValidationError';
  }
}

type ParamValue = string | number | null;

/**
 * Validate caller overrides against the spec, layered over defaults.
 *
 * @param spec      Allowlisted params with type + rules.
 * @param defaults  Saved default values (used when a param is not overridden).
 * @param overrides Caller-supplied values. Unknown keys → reject.
 * @returns         `{ name: value|null }` for every spec param.
 */
export function validatePublicParams(
  spec: QueryParamSpec[],
  defaults: Record<string, ParamValue>,
  overrides: Record<string, unknown>,
): Record<string, ParamValue> {
  const byName = new Map(spec.map((p) => [p.name, p]));

  // Reject any override that isn't an allowlisted param — no silent drop.
  for (const key of Object.keys(overrides)) {
    if (!byName.has(key)) {
      throw new ParamValidationError(`Unknown parameter: ${key}`);
    }
  }

  const out: Record<string, ParamValue> = {};
  for (const p of spec) {
    if (Object.prototype.hasOwnProperty.call(overrides, p.name)) {
      out[p.name] = coerceAndValidate(p, overrides[p.name]);
    } else {
      // Fall back to the saved default (assumed already valid).
      out[p.name] = (defaults[p.name] ?? null) as ParamValue;
    }
  }
  return out;
}

function coerceAndValidate(spec: QueryParamSpec, raw: unknown): ParamValue {
  // Explicit None — allowed for any type; the SQL layer removes/NULLs the filter.
  if (raw === null) return null;

  const rules = spec.rules ?? {};
  switch (spec.type) {
    case 'number':
      return validateNumber(spec.name, raw, rules);
    case 'date':
      return validateDate(spec.name, raw, rules);
    case 'text':
    default:
      return validateText(spec.name, raw, rules);
  }
}

function validateNumber(name: string, raw: unknown, rules: ParamRule): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) throw new ParamValidationError(`Parameter ${name} must be a number`);
  if (rules.enum && !rules.enum.includes(n)) throw new ParamValidationError(`Parameter ${name} is not an allowed value`);
  if (rules.min !== undefined && n < rules.min) throw new ParamValidationError(`Parameter ${name} must be ≥ ${rules.min}`);
  if (rules.max !== undefined && n > rules.max) throw new ParamValidationError(`Parameter ${name} must be ≤ ${rules.max}`);
  return n;
}

function validateText(name: string, raw: unknown, rules: ParamRule): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new ParamValidationError(`Parameter ${name} must be a string`);
  }
  const s = String(raw);
  if (rules.maxLength !== undefined && s.length > rules.maxLength) {
    throw new ParamValidationError(`Parameter ${name} exceeds maxLength ${rules.maxLength}`);
  }
  if (rules.enum && !rules.enum.includes(s)) throw new ParamValidationError(`Parameter ${name} is not an allowed value`);
  if (rules.pattern && !new RegExp(`^(?:${rules.pattern})$`).test(s)) {
    throw new ParamValidationError(`Parameter ${name} does not match the required pattern`);
  }
  return s;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function validateDate(name: string, raw: unknown, rules: ParamRule): string {
  const s = String(raw);
  if (!ISO_DATE.test(s) || Number.isNaN(Date.parse(s))) {
    throw new ParamValidationError(`Parameter ${name} must be an ISO date`);
  }
  if (rules.enum && !rules.enum.includes(s)) throw new ParamValidationError(`Parameter ${name} is not an allowed value`);
  return s;
}
