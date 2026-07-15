/**
 * Validator wiring contracts (RFC §11 — closing the agent loop):
 * - columns are OPTIONAL: headless/unknown-result paths still get schema/policy/css
 *   checks, but field-reference checks are skipped (no false E_FIELD_NOT_FOUND).
 * - formatVizIssues renders issues as the tool-result feedback string.
 */
import { describe, it, expect } from 'vitest';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { formatVizIssues } from '@/lib/viz/types';
import type { VizIssue } from '@/lib/viz/types';

const barEnvelope = (encoding: Record<string, unknown>) => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec: { mark: { type: 'bar' }, encoding } },
});

describe('validateVizEnvelope without columns', () => {
  const ENC = {
    x: { field: 'anything_at_all', type: 'nominal' },
    y: { field: 'made_up_field', type: 'quantitative' },
  };

  it('skips field-reference checks (no false positives when the result is unknown)', () => {
    const result = validateVizEnvelope(barEnvelope(ENC), undefined);
    expect(result.ok).toBe(true);
    expect(result.issues.filter(i => i.code === 'E_FIELD_NOT_FOUND')).toEqual([]);
  });

  it('still rejects schema violations', () => {
    const result = validateVizEnvelope(
      barEnvelope({ x: { field: 'a', type: 'NOT_A_TYPE' } }), undefined);
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('E_SCHEMA');
  });

  it('still rejects external data', () => {
    const env = {
      version: 2,
      source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec: { data: { url: 'https://x/y.csv' }, mark: 'bar', encoding: {} } },
    };
    const result = validateVizEnvelope(env, undefined);
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('E_EXTERNAL_DATA');
  });

  it('still checks recipe existence and table css policy', () => {
    const badRecipe = { version: 2, source: { kind: 'recipe', recipe: 'minusx/nope@9', bindings: { a: 'b' } } };
    expect(validateVizEnvelope(badRecipe, undefined).ok).toBe(false);
    const badCss = { version: 2, source: { kind: 'table', css: '@import url("https://x");' } };
    expect(validateVizEnvelope(badCss, undefined).issues[0].code).toBe('E_CSS');
  });

  it('recipe bindings are not field-checked without columns', () => {
    const recipe = { version: 2, source: { kind: 'recipe', recipe: 'minusx/funnel@1', bindings: { stage: 'unknown_col', value: 'other_col' } } };
    expect(validateVizEnvelope(recipe, undefined).ok).toBe(true);
  });
});

describe('formatVizIssues', () => {
  it('renders one line per issue with severity, code, path, message', () => {
    const issues: VizIssue[] = [
      { severity: 'error', code: 'E_FIELD_NOT_FOUND', path: '/source/spec/encoding/y', message: '"revenu" is not in the query result' },
      { severity: 'warning', code: 'W_COMPILE', path: '/source/spec', message: 'something minor' },
    ];
    const text = formatVizIssues(issues);
    expect(text).toContain('[error] E_FIELD_NOT_FOUND at /source/spec/encoding/y: "revenu" is not in the query result');
    expect(text).toContain('[warning] W_COMPILE');
  });
});
