import { describe, it, expect } from 'vitest';
import { validateOrgConfig } from '@/lib/validation/config-validators';

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
