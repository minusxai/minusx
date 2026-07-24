// content-validators: formatErrors() de-noises the Ajv `Nullable` 3-error burst
// and reports expected-vs-got, so validation messages are actionable.
import { describe, it, expect } from 'vitest';
import { validateFileState } from '../content-validators';

describe('content-validators: config file heals inert schema-drift', () => {
  it('accepts a config that only trips retired file/viz types + llm.assignments (heals, does not reject)', () => {
    const content = {
      branding: { displayName: 'Acme', agentName: 'Agent', favicon: '/f.ico' },
      supportedFileTypes: ['question', 'conversation'],           // conversation retired
      accessRules: { admin: { createTypes: ['question', 'conversation'] } },
      llm: { providers: [{ name: 'openai', provider: 'openai' }], assignments: { analyst: {} } }, // retired shape
      setupWizard: { status: 'complete' },
    };
    expect(validateFileState({ type: 'config', content })).toBeNull();
  });

  it('still REJECTS a genuinely malformed config, with a specific reason (not the canned message)', () => {
    const err = validateFileState({
      type: 'config',
      content: { llm: { providers: [{ name: 'a', provider: 'openai' }], grades: { core: { providerName: 'ghost' } } } },
    }) ?? '';
    expect(err).toMatch(/references provider 'ghost', which does not exist/);
    expect(err).not.toBe('Invalid config structure');
  });
});

describe('content-validators: actionable error messages', () => {
  it('reports expected-vs-got and drops the Nullable anyOf noise (xCols/yCols as objects)', () => {
    // The exact mistake the agent makes: per-series {name,color,label} objects
    // stuffed into xCols/yCols, which only accept column-name strings.
    const content = {
      query: 'SELECT month, revenue_actual, revenue_budget FROM monthly_financials',
      connection_name: 'static',
      vizSettings: {
        type: 'bar',
        xCols: [{ name: 'month' }],
        yCols: [{ name: 'revenue_actual', color: '#1e2d3d', label: 'Actual' }],
      },
    };
    const err = validateFileState({ type: 'question', content }) ?? '';

    // Actionable: names the expected type AND what was actually received.
    expect(err).toMatch(/xCols\[0\]: expected string, got object/);
    // De-noised: none of the Nullable-union wall.
    expect(err).not.toMatch(/should be null/);
    expect(err).not.toMatch(/anyOf/);
    // Bridges to the supported per-series styling path.
    expect(err).toMatch(/styleConfig\.colors/);
  });

  it('formats a plain type mismatch generally — not just viz fields', () => {
    const content = { query: 'SELECT 1', connection_name: 123, vizSettings: { type: 'table' } };
    const err = validateFileState({ type: 'question', content }) ?? '';
    expect(err).toMatch(/connection_name: expected string, got number/);
    expect(err).not.toMatch(/should be null/);
    // No xCols/yCols involved → no styling hint appended.
    expect(err).not.toMatch(/styleConfig\.colors/);
  });

  it('passes valid content (returns null)', () => {
    const content = { query: 'SELECT 1', connection_name: 'static', vizSettings: { type: 'table' } };
    expect(validateFileState({ type: 'question', content })).toBeNull();
  });
});
