/**
 * The per-file-type content schema injected into each file's skill must be the LIVE schema derived
 * from the TypeBox source of truth (atlas-schemas.ts) — never a hand-typed example that can drift.
 * These tests pin that: the rendered text reflects the actual *Content defs, is valid JSON, stays
 * compact (the legacy viz schema is deliberately not inlined), and is safe to splice through the prompt
 * `{ref}` template engine.
 */
import { describe, it, expect } from 'vitest';
import { validateFileState } from '../content-validators';
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

  it('collapses vizSettings to a pointer — the legacy viz schema is never inlined', () => {
    const q = contentSchemaText('question');
    expect(q).toContain('vizSettings');
    expect(q).not.toContain('ChoroplethConfig'); // a viz-only def — must NOT be inlined here
  });

  it('collapses the viz envelope to a pointer — source-kind schemas are never inlined', () => {
    const q = contentSchemaText('question');
    expect(q).toContain('"viz"');       // the property is still documented...
    expect(q).toContain('Vega-Lite');   // ...and the stub names the grammar
    expect(q).not.toContain('detachedFrom'); // VizSourceVegaLite/Vega marker — must NOT be inlined
    expect(q).not.toContain('RESERVED:');    // envelope reserved-namespace fields
    // notebooks embed viz per SQL cell — the deep walk must collapse those too
    const n = contentSchemaText('notebook');
    expect(n).not.toContain('detachedFrom');
    expect(n).not.toContain('RESERVED:');
  });

  it('stays compact — the viz collapse holds the skill-schema token line', () => {
    expect(contentSchemaText('question').length).toBeLessThan(20_000);
    expect(contentSchemaText('notebook').length).toBeLessThan(30_000);
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

// vizSettings is OPTIONAL (viz-first): viz-only content — no vizSettings — must
// validate for both questions and notebook SQL cells. On a rollback to the
// classic format such files fall back at render time; nothing injects a
// placeholder into authored content.
describe('vizSettings optionality (viz-first authoring)', () => {
  it('a question without vizSettings validates', () => {
    const err = validateFileState({
      type: 'question',
      content: { description: '', query: 'SELECT 1', connection_name: 'db', parameters: [], viz: { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } } },
    });
    expect(err).toBeNull();
  });

  it('a notebook SQL cell without vizSettings validates', () => {
    const err = validateFileState({
      type: 'notebook',
      content: { description: '', cells: [{ type: 'sql', id: 'c1', name: null, query: 'SELECT 1', parameters: [], parameterValues: {}, connection_name: 'db', viz: { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } } }] },
    });
    expect(err).toBeNull();
  });
});
