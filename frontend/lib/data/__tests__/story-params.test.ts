// Story <Param> declarations round-trip: jsx attrs → StoryParam → placeholder → StoryParam → jsx.
import { describe, it, expect } from 'vitest';
import {
  paramFromJsxAttrs, paramToPlaceholder, paramToJsx, extractStoryParams,
  placeholdersToParamJsx, normalizeParamType, lintStoryParams, resolveImportedParam, type StoryParam,
} from '../story-params';

describe('story-params — type normalisation', () => {
  it('maps author types to the canonical ParameterType', () => {
    expect(normalizeParamType('string')).toBe('text');
    expect(normalizeParamType('integer')).toBe('number');
    expect(normalizeParamType('date')).toBe('date');
    expect(normalizeParamType(undefined)).toBe('text');
    expect(normalizeParamType('bogus')).toBe('text');
  });
});

describe('story-params — jsx attrs ⇄ StoryParam', () => {
  it('builds a param from <Param> attributes (nullable defaults true)', () => {
    expect(paramFromJsxAttrs({ name: 'city', type: 'string' })).toEqual({ name: 'city', type: 'text', nullable: true });
    expect(paramFromJsxAttrs({ name: 'n', type: 'number', nullable: false })).toEqual({ name: 'n', type: 'number', nullable: false });
    expect(paramFromJsxAttrs({ type: 'text' })).toBeNull(); // name required
  });

  it('reads an import/autocomplete source (id + column, column defaults to name)', () => {
    expect(paramFromJsxAttrs({ name: 'city', type: 'text', id: 5 })).toMatchObject({ source: { questionId: 5, column: 'city' } });
    expect(paramFromJsxAttrs({ name: 'city', type: 'text', id: 5, column: 'region' })).toMatchObject({ source: { questionId: 5, column: 'region' } });
  });
});

describe('story-params — placeholder round-trip (through content.story HTML)', () => {
  const params: StoryParam[] = [
    { name: 'city', type: 'text', nullable: false, source: { questionId: 5, column: 'region' } },
    { name: 'min_rev', type: 'number', nullable: true },
  ];

  it('StoryParam → placeholder → StoryParam is stable', () => {
    for (const p of params) {
      const html = paramToPlaceholder(p);
      expect(html).toContain('data-param-name');
      expect(extractStoryParams(html)).toEqual([p]);
    }
  });

  it('extractStoryParams finds every declared param in a story body', () => {
    const html = `<div class="story"><h1>Hi</h1>${params.map(paramToPlaceholder).join('')}<div data-question-id="5"></div></div>`;
    expect(extractStoryParams(html)).toEqual(params);
  });

  it('placeholdersToParamJsx rewrites placeholders back to <Param/> (for the agent view)', () => {
    const html = paramToPlaceholder(params[0]);
    const jsx = placeholdersToParamJsx(html);
    expect(jsx).toBe('<Param name="city" type="text" nullable={false} id={5} column="region" />');
    // and that jsx parses back to the same param
    expect(paramToJsx(params[0])).toBe(jsx);
  });
});

describe('story-params — lint (non-blocking feedback)', () => {
  it('warns when an embedded question needs a param that is not declared', () => {
    const warnings = lintStoryParams(
      [{ name: 'city', type: 'text', nullable: true }],
      [{ id: 5, query: 'SELECT * FROM t WHERE city = :city AND rev > :min_rev' }],
    );
    expect(warnings.some((w) => w.includes(':min_rev') && w.includes('Question 5'))).toBe(true);
    expect(warnings.some((w) => w.includes(':city'))).toBe(false); // city IS declared
  });

  it('warns on a type mismatch and on a declared-but-unused param', () => {
    const mismatch = lintStoryParams(
      [{ name: 'min_rev', type: 'text', nullable: true }],
      [{ id: 9, query: 'SELECT * FROM t WHERE rev > :min_rev', parameters: [{ name: 'min_rev', type: 'number', label: null, source: null }] }],
    );
    expect(mismatch.some((w) => w.includes('min_rev') && w.includes('number') && w.includes('text'))).toBe(true);

    const unused = lintStoryParams([{ name: 'ghost', type: 'text', nullable: true }], [{ id: 1, query: 'SELECT 1' }]);
    expect(unused.some((w) => w.includes('ghost') && w.includes('declared'))).toBe(true);
  });

  it('clean story (all params declared, right types) → no warnings', () => {
    const warnings = lintStoryParams(
      [{ name: 'city', type: 'text', nullable: true }, { name: 'min_rev', type: 'number', nullable: true }],
      [{ id: 5, query: 'SELECT * FROM t WHERE city = :city AND rev > :min_rev', parameters: [{ name: 'city', type: 'text', label: null, source: null }, { name: 'min_rev', type: 'number', label: null, source: null }] }],
    );
    expect(warnings).toEqual([]);
  });
});

describe('story-params — import resolution', () => {
  it('inherits the type from the source question when imported', () => {
    const p: StoryParam = { name: 'city', type: 'text', nullable: true, source: { questionId: 5, column: 'city' } };
    const resolved = resolveImportedParam(p, [{ name: 'city', type: 'date', label: null, source: null }]);
    expect(resolved.type).toBe('date'); // inherited from q5's :city
  });
  it('is a no-op without a source', () => {
    const p: StoryParam = { name: 'x', type: 'text', nullable: true };
    expect(resolveImportedParam(p, [])).toEqual(p);
  });
});
