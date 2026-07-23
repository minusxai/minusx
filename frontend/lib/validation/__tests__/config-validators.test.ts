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
        grades: { core: { providerName: 'OpenAI', model: 'gpt-4.1' } },
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

  it('rejects unknown grade keys', () => {
    const error = orgConfigValidationError({
      llm: {
        providers: [{ name: 'a', provider: 'openai', apiKey: 'k' }],
        grades: { huge: { providerName: 'a', model: 'gpt-4.1' } },
      },
    });
    expect(error).toMatch(/unknown grade 'huge'/);
  });

  it('rejects a grade mapping without a provider', () => {
    const error = orgConfigValidationError({
      llm: {
        providers: [{ name: 'a', provider: 'openai', apiKey: 'k' }],
        grades: { core: { model: 'gpt-4.1' } },
      },
    });
    expect(error).toMatch(/grade 'core' is missing its provider/);
  });

  it('rejects the retired assignments shape with a pointer to grades', () => {
    const error = orgConfigValidationError({
      llm: {
        providers: [{ name: 'a', provider: 'openai', apiKey: 'k' }],
        assignments: { analyst: { chain: [{ providerName: 'a', model: 'gpt-4.1' }] } },
      },
    });
    expect(error).toMatch(/`assignments` was replaced by `grades`/);
  });

  it('rejects unknown agent keys', () => {
    const error = orgConfigValidationError({
      llm: { agents: { 'mega-agent': { defaultGrade: 'core' } } },
    });
    expect(error).toMatch(/unknown agent 'mega-agent'/);
  });

  it('rejects invalid grades inside an agent policy', () => {
    expect(orgConfigValidationError({
      llm: { agents: { analyst: { allowedGrades: ['core', 'huge'] } } },
    })).toMatch(/agent 'analyst': invalid grade 'huge'/);
    expect(orgConfigValidationError({
      llm: { agents: { analyst: { defaultGrade: 'huge' } } },
    })).toMatch(/agent 'analyst': invalid grade 'huge'/);
    expect(orgConfigValidationError({
      llm: { agents: { analyst: { allowedGrades: [] } } },
    })).toMatch(/agent 'analyst': allowedGrades must be a non-empty array/);
  });

  it('returns null for a valid config', () => {
    expect(orgConfigValidationError({
      llm: {
        providers: [{ name: 'a', provider: 'openai', apiKey: 'k' }],
        grades: {
          lite: { providerName: 'a', model: 'gpt-5.6-luna' },
          core: { providerName: 'a', model: 'gpt-5.6-terra' },
        },
        agents: { analyst: { allowedGrades: ['core', 'advanced'], defaultGrade: 'core' } },
      },
    })).toBeNull();
  });
});
