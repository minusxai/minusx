/**
 * The V2 envelope on QuestionContent: content.viz is schema-validated at save time
 * (envelope shape only — deep spec validation needs result columns and runs in the
 * ValidateVisualization path, lib/viz/validate.ts).
 */
import { describe, it, expect } from 'vitest';
import { validateFileState } from '@/lib/validation/content-validators';

const baseQuestion = {
  description: null,
  query: 'SELECT 1',
  vizSettings: { type: 'table' },
  parameters: null,
  parameterValues: null,
  connection_name: '',
  references: null,
  cachePolicy: null,
};

const vizEnvelope = {
  version: 2,
  source: {
    kind: 'vega-lite',
    grammar: 'vega-lite@6',
    spec: { mark: 'bar', encoding: { x: { field: 'a', type: 'nominal' } } },
  },
};

describe('QuestionContent.viz envelope schema', () => {
  it('accepts a question with a valid viz envelope', () => {
    const err = validateFileState({ type: 'question', content: { ...baseQuestion, viz: vizEnvelope } });
    expect(err).toBeNull();
  });

  it('accepts a question without viz (legacy vizSettings only)', () => {
    const err = validateFileState({ type: 'question', content: baseQuestion });
    expect(err).toBeNull();
  });

  it('rejects a viz envelope with the wrong version', () => {
    const err = validateFileState({
      type: 'question',
      content: { ...baseQuestion, viz: { ...vizEnvelope, version: 3 } },
    });
    expect(err).not.toBeNull();
    expect(err).toContain('viz');
  });

  it('rejects a viz source with an unknown kind', () => {
    const err = validateFileState({
      type: 'question',
      content: {
        ...baseQuestion,
        viz: { version: 2, source: { kind: 'echarts', grammar: 'vega-lite@6', spec: {} } },
      },
    });
    expect(err).not.toBeNull();
  });

  it('rejects a vega-lite source missing the pinned grammar', () => {
    const err = validateFileState({
      type: 'question',
      content: {
        ...baseQuestion,
        viz: { version: 2, source: { kind: 'vega-lite', spec: { mark: 'bar' } } },
      },
    });
    expect(err).not.toBeNull();
  });
});
