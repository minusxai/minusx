import { describe, it, expect } from 'vitest';
import { validateOrgConfig, orgConfigValidationError } from '@/lib/validation/config-validators';

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

describe('orgConfigValidationError — llm section reasons', () => {
  it('names the dangling provider reference (the rename-without-cascade case)', () => {
    const error = orgConfigValidationError({
      llm: {
        providers: [{ name: 'Default', provider: 'openai', apiKey: 'k' }],
        assignments: { analyst: { chain: [{ providerName: 'OpenAI', model: 'gpt-4.1' }] } },
      },
    });
    expect(error).toMatch(/references provider 'OpenAI', which does not exist/);
  });

  it('names a duplicate provider', () => {
    const error = orgConfigValidationError({
      llm: { providers: [{ name: 'a', provider: 'openai' }, { name: 'a', provider: 'anthropic' }] },
    });
    expect(error).toMatch(/duplicate provider name 'a'/);
  });

  it('returns null for a valid config', () => {
    expect(orgConfigValidationError({
      llm: {
        providers: [{ name: 'a', provider: 'openai', apiKey: 'k' }],
        assignments: { analyst: { chain: [{ providerName: 'a', model: 'gpt-4.1' }] } },
      },
    })).toBeNull();
  });
});
