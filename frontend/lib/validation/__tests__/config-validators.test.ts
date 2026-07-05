import { describe, it, expect } from 'vitest';
import { validateOrgConfig } from '@/lib/validation/config-validators';
import { VIZ_TYPES } from '@/lib/validation/atlas-schemas';

describe('validateOrgConfig - supportedFileTypes', () => {
  it('accepts a config without supportedFileTypes', () => {
    expect(validateOrgConfig({ branding: { displayName: 'X' } })).toBe(true);
  });

  it('accepts a valid supportedFileTypes list', () => {
    expect(validateOrgConfig({ supportedFileTypes: ['question', 'dashboard', 'story'] })).toBe(true);
  });

  it('rejects an empty supportedFileTypes list', () => {
    expect(validateOrgConfig({ supportedFileTypes: [] })).toBe(false);
  });

  it('rejects unknown file types', () => {
    expect(validateOrgConfig({ supportedFileTypes: ['question', 'not-a-real-type'] })).toBe(false);
  });

  it('rejects a non-array supportedFileTypes', () => {
    expect(validateOrgConfig({ supportedFileTypes: 'question' })).toBe(false);
  });
});

describe('validateOrgConfig - allowedVizTypes', () => {
  it('accepts a config without allowedVizTypes', () => {
    expect(validateOrgConfig({ branding: { displayName: 'X' } })).toBe(true);
  });

  it('accepts every canonical viz type', () => {
    expect(validateOrgConfig({ allowedVizTypes: [...VIZ_TYPES] })).toBe(true);
  });

  it('accepts single_value (regression: was missing from the validator list)', () => {
    expect(validateOrgConfig({ allowedVizTypes: ['table', 'single_value'] })).toBe(true);
  });

  it('rejects an empty allowedVizTypes list', () => {
    expect(validateOrgConfig({ allowedVizTypes: [] })).toBe(false);
  });

  it('rejects unknown viz types', () => {
    expect(validateOrgConfig({ allowedVizTypes: ['table', 'not-a-real-viz'] })).toBe(false);
  });

  it('rejects a non-array allowedVizTypes', () => {
    expect(validateOrgConfig({ allowedVizTypes: 'table' })).toBe(false);
  });
});
