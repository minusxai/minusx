// content-validators: formatErrors() de-noises the Ajv `Nullable` 3-error burst
// and reports expected-vs-got, so validation messages are actionable.
import { describe, it, expect } from 'vitest';
import { validateFileState } from '../content-validators';
import { atlasSchema } from '../atlas-json-schemas';

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

describe('VizSettings.typeLocked', () => {
  it('is declared on the schema (agent-facing doc) and accepts boolean/null/absent', () => {
    const vizSettings = (atlasSchema as Record<string, any>).$defs.QuestionContent.properties.vizSettings;
    const obj = vizSettings.anyOf
      ? vizSettings.anyOf.find((v: Record<string, any>) => v.properties)
      : vizSettings;
    expect(Object.keys(obj.properties)).toContain('typeLocked');

    for (const typeLocked of [true, false, null]) {
      const content = { query: 'SELECT 1', connection_name: 'static', vizSettings: { type: 'bar', typeLocked } };
      expect(validateFileState({ type: 'question', content })).toBeNull();
    }
    // absent stays valid — legacy saved questions are untouched
    const legacy = { query: 'SELECT 1', connection_name: 'static', vizSettings: { type: 'bar' } };
    expect(validateFileState({ type: 'question', content: legacy })).toBeNull();
  });

  it('rejects a non-boolean typeLocked', () => {
    const content = { query: 'SELECT 1', connection_name: 'static', vizSettings: { type: 'bar', typeLocked: 'yes' } };
    const err = validateFileState({ type: 'question', content }) ?? '';
    expect(err).toMatch(/typeLocked: expected boolean, got string/);
  });
});
