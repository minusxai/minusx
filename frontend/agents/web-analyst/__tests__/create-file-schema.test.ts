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

describe('CreateFile/EditFile describe the MARKUP edit surface (File Architecture v2)', () => {
  it('EditFile description teaches the uniform jsx markup format, not JSON content', () => {
    const desc = EditFile.schema.description ?? '';
    expect(desc).toContain('MARKUP');
    expect(desc).toContain('<item>');             // arrays
    expect(desc).toContain('template-literal');   // raw SQL child
    expect(desc).toContain('type="number"');      // schemaless annotation
    // No <props> wrapper and no embedded JSON content-schema in the new model.
    expect(desc).not.toContain('<props>');
    expect(desc).not.toContain('AtlasQuestionFile');
  });

  it('CreateFile exposes a markup param and references the EditFile description', () => {
    const props = (CreateFile.schema.parameters as { properties?: Record<string, { description?: string }> }).properties ?? {};
    expect(props.markup?.description ?? '').toMatch(/MARKUP/);
    expect(props.markup?.description ?? '').toMatch(/EditFile/);
  });
});
