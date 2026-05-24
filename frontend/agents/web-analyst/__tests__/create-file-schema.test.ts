// CreateFile param schema: `content` should validate as an object (the intended
// shape that stops the LLM stringifying), tolerate a JSON string defensively
// (the handler parses it), and be optional (folders).
import { describe, it, expect } from 'vitest';
import { CreateFile, EditFile } from '../web-analyst';
import { validateParameters } from '@/orchestrator/utils';

const base = { file_type: 'question', name: 'Q', path: '/org' };

describe('CreateFile content schema', () => {
  it('accepts content as an object (the intended shape)', () => {
    expect(
      validateParameters(CreateFile.schema.parameters, {
        ...base,
        content: { query: 'SELECT 1', connection_name: 'static', vizSettings: { type: 'table' }, parameters: [] },
      }).ok,
    ).toBe(true);
  });

  it('still accepts a JSON string defensively (handler parses it)', () => {
    expect(
      validateParameters(CreateFile.schema.parameters, { ...base, content: '{"query":"SELECT 1"}' }).ok,
    ).toBe(true);
  });

  it('accepts omitted content (e.g. folders)', () => {
    expect(validateParameters(CreateFile.schema.parameters, base).ok).toBe(true);
  });
});

describe('CreateFile/EditFile embed the per-file-type content schema (Python parity)', () => {
  it('EditFile description embeds the no-viz content schema (question + dashboard union)', () => {
    const desc = EditFile.schema.description ?? '';
    expect(desc).toContain('Content schema');
    expect(desc).toContain('AtlasQuestionFile');
    expect(desc).toContain('AtlasDashboardFile');
    // It must be the NO-VIZ variant (viz-only defs stripped for token economy).
    expect(desc).not.toContain('ChoroplethConfig');
  });

  it('CreateFile content description points to the EditFile content schema', () => {
    const contentSchema = (CreateFile.schema.parameters as { properties?: { content?: { description?: string } } })
      .properties?.content;
    expect(contentSchema?.description ?? '').toMatch(/EditFile/);
    expect(contentSchema?.description ?? '').toMatch(/do NOT stringify/i);
  });
});
