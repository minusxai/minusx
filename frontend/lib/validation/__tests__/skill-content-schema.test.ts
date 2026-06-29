/**
 * The per-file-type content schema injected into each file's skill must be the LIVE schema derived
 * from the TypeBox source of truth (atlas-schemas.ts) — never a hand-typed example that can drift.
 * These tests pin that: the rendered text reflects the actual *Content defs, is valid JSON, stays
 * compact (viz deferred to the visualizations skill), and is safe to splice through the prompt
 * `{ref}` template engine.
 */
import { describe, it, expect } from 'vitest';
import {
  contentSchemaText,
  SCHEMA_TEMPLATE_VARS,
  ATLAS_SCHEMA_FILE_TYPES,
  type AtlasSchemaFileType,
} from '../atlas-json-schemas';

describe('contentSchemaText — live per-file-type content schema for skills', () => {
  it('covers exactly the Atlas file types that have a TypeBox content schema', () => {
    expect(ATLAS_SCHEMA_FILE_TYPES).toEqual(['question', 'dashboard', 'story', 'notebook', 'context']);
  });

  it('context schema is the flat knowledge view (no whitelist or version bookkeeping)', () => {
    const c = JSON.parse(contentSchemaText('context'));
    expect(Object.keys(c.properties)).toEqual(
      expect.arrayContaining(['docs', 'metrics', 'annotations', 'skills', 'evals']),
    );
    // the human-managed whitelist + version-based + computed fields must NOT leak into the schema
    for (const noise of ['whitelist', 'versions', 'published', 'fullSchema', 'parentSchema']) {
      expect(c.properties).not.toHaveProperty(noise);
    }
  });

  it('renders valid JSON-Schema (type: object) for every type', () => {
    for (const t of ATLAS_SCHEMA_FILE_TYPES) {
      const parsed = JSON.parse(contentSchemaText(t));
      expect(parsed.type).toBe('object');
      expect(parsed.properties).toBeTypeOf('object');
    }
  });

  it('question schema reflects live QuestionContent fields (not a toy example)', () => {
    const q = JSON.parse(contentSchemaText('question'));
    expect(Object.keys(q.properties)).toEqual(
      expect.arrayContaining(['query', 'parameters', 'connection_name']),
    );
  });

  it('notebook schema exposes its cells field', () => {
    const n = JSON.parse(contentSchemaText('notebook'));
    expect(n.properties).toHaveProperty('cells');
  });

  it('collapses vizSettings to a pointer — full viz schema stays in the visualizations skill', () => {
    const q = contentSchemaText('question');
    expect(q).toContain('vizSettings');
    expect(q).not.toContain('ChoroplethConfig'); // a viz-only def — must NOT be inlined here
  });

  it('contains NO nested {a.b} refs (those would THROW in the {ref} template engine)', () => {
    // Bare {N}/{142} from embed-syntax docs are fine — resolveTemplates leaves an unknown {word}
    // untouched. Only dotted {a.b} refs throw "Template not found", so those must be absent.
    for (const t of ATLAS_SCHEMA_FILE_TYPES) {
      expect(contentSchemaText(t).match(/\{\w+(?:\.\w+)+\}/g)).toBeNull();
    }
  });

  it('throws for a file type with no Atlas content schema (e.g. report/alert)', () => {
    expect(() => contentSchemaText('report' as AtlasSchemaFileType)).toThrow(/no Atlas content schema/i);
  });

  it('SCHEMA_TEMPLATE_VARS keys each schema as schema_<type> for prompt injection', () => {
    expect(Object.keys(SCHEMA_TEMPLATE_VARS)).toEqual([
      'schema_question', 'schema_dashboard', 'schema_story', 'schema_notebook', 'schema_context',
    ]);
    expect(SCHEMA_TEMPLATE_VARS.schema_question).toBe(contentSchemaText('question'));
  });
});
