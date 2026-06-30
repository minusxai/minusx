import { describe, it, expect } from 'vitest';
import { validatePublicParams, ParamValidationError } from '../param-validation';
import type { QueryParamSpec } from '../types';

const SPEC: QueryParamSpec[] = [
  { name: 'country', type: 'text', rules: { maxLength: 20 } },
  { name: 'status', type: 'text', rules: { enum: ['open', 'closed'] } },
  { name: 'limit', type: 'number', rules: { min: 1, max: 100 } },
  { name: 'since', type: 'date' },
];

const DEFAULTS = { country: 'US', status: 'open', limit: 10, since: '2024-01-01' };

describe('validatePublicParams', () => {
  it('fills missing params from defaults', () => {
    expect(validatePublicParams(SPEC, DEFAULTS, {})).toEqual(DEFAULTS);
  });

  it('accepts and coerces valid overrides', () => {
    const out = validatePublicParams(SPEC, DEFAULTS, { country: 'India', limit: '50', status: 'closed' });
    expect(out).toEqual({ country: 'India', status: 'closed', limit: 50, since: '2024-01-01' });
  });

  it('rejects an unknown param key (not in the allowlist)', () => {
    expect(() => validatePublicParams(SPEC, DEFAULTS, { evil: "1; DROP TABLE" }))
      .toThrow(ParamValidationError);
  });

  it('rejects a text value over maxLength', () => {
    expect(() => validatePublicParams(SPEC, DEFAULTS, { country: 'x'.repeat(21) }))
      .toThrow(/maxLength|too long/i);
  });

  it('rejects a value outside the enum', () => {
    expect(() => validatePublicParams(SPEC, DEFAULTS, { status: 'deleted' })).toThrow(ParamValidationError);
  });

  it('rejects a non-numeric value for a number param', () => {
    expect(() => validatePublicParams(SPEC, DEFAULTS, { limit: 'abc' })).toThrow(ParamValidationError);
  });

  it('rejects a number below min / above max', () => {
    expect(() => validatePublicParams(SPEC, DEFAULTS, { limit: 0 })).toThrow(ParamValidationError);
    expect(() => validatePublicParams(SPEC, DEFAULTS, { limit: 101 })).toThrow(ParamValidationError);
  });

  it('rejects a non-ISO date for a date param', () => {
    expect(() => validatePublicParams(SPEC, DEFAULTS, { since: 'not-a-date' })).toThrow(ParamValidationError);
    expect(validatePublicParams(SPEC, DEFAULTS, { since: '2025-06-30' }).since).toBe('2025-06-30');
  });

  it('rejects a text value not matching an anchored pattern', () => {
    const spec: QueryParamSpec[] = [{ name: 'code', type: 'text', rules: { pattern: '[A-Z]{3}' } }];
    expect(() => validatePublicParams(spec, { code: 'USD' }, { code: 'us' })).toThrow(ParamValidationError);
    expect(validatePublicParams(spec, { code: 'USD' }, { code: 'EUR' }).code).toBe('EUR');
  });

  it('allows explicit null (None) regardless of type', () => {
    expect(validatePublicParams(SPEC, DEFAULTS, { limit: null }).limit).toBeNull();
  });
});
