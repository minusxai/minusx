// Story <Param> declarations round-trip: jsx attrs → StoryParam → placeholder → StoryParam → jsx.
import { describe, it, expect } from 'vitest';
import {
  paramFromJsxAttrs, paramToPlaceholder, paramToJsx, extractStoryParams,
  placeholdersToParamJsx, normalizeParamType, lintStoryParams, lintDashboardParams, lintStoryParamSources, paramFromPlaceholderEl, storyParamToQuestionParameter, type StoryParam,
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

  it('labels inline (file-less) questions as "Inline question #N" in warnings', () => {
    const warnings = lintStoryParams(
      [],
      [{ id: 0, inlineIndex: 2, query: 'SELECT * FROM t WHERE m = :month' }],
    );
    expect(warnings.some((w) => w.includes('Inline question #2') && w.includes(':month'))).toBe(true);
    expect(warnings.some((w) => w.includes('Question 0'))).toBe(false);
  });

  it('clean story (all params declared, right types) → no warnings', () => {
    const warnings = lintStoryParams(
      [{ name: 'city', type: 'text', nullable: true }, { name: 'min_rev', type: 'number', nullable: true }],
      [{ id: 5, query: 'SELECT * FROM t WHERE city = :city AND rev > :min_rev', parameters: [{ name: 'city', type: 'text', label: null, source: null }, { name: 'min_rev', type: 'number', label: null, source: null }] }],
    );
    expect(warnings).toEqual([]);
  });
});

describe('story-params — dashboard param lint (type-conflict only)', () => {
  it('warns when two questions use the same :param name with conflicting types', () => {
    const warnings = lintDashboardParams([
      { id: 1, query: 'SELECT * FROM a WHERE x = :region', parameters: [{ name: 'region', type: 'text', label: null, source: null }] },
      { id: 2, query: 'SELECT * FROM b WHERE x = :region', parameters: [{ name: 'region', type: 'number', label: null, source: null }] },
    ]);
    expect(warnings.some((w) => w.includes(':region') && w.includes('text') && w.includes('number'))).toBe(true);
  });

  it('no warning when the same param name has the same type across questions', () => {
    const warnings = lintDashboardParams([
      { id: 1, query: 'SELECT * FROM a WHERE x = :region', parameters: [{ name: 'region', type: 'text', label: null, source: null }] },
      { id: 2, query: 'SELECT * FROM b WHERE x = :region', parameters: [{ name: 'region', type: 'text', label: null, source: null }] },
    ]);
    expect(warnings).toEqual([]);
  });
});

describe('story-params — source validation (FIX-1)', () => {
  const sourced = (name: string, qid: number): StoryParam => ({ name, type: 'text', nullable: true, source: { questionId: qid, column: name } });

  it('warns when a <Param id=N> imports from a non-existent question', () => {
    const warnings = lintStoryParamSources([sourced('region', 1)], () => undefined);
    expect(warnings.some((w) => w.includes('#1') && w.includes("doesn't exist"))).toBe(true);
  });

  it('warns when the referenced file is not a question (e.g. a dashboard)', () => {
    const warnings = lintStoryParamSources([sourced('region', 7)], () => 'dashboard');
    expect(warnings.some((w) => w.includes('#7') && w.includes('dashboard') && w.includes('not a question'))).toBe(true);
  });

  it('no warning when the source resolves to an existing question; ignores source-less params', () => {
    const declared: StoryParam[] = [sourced('city', 5), { name: 'plain', type: 'text', nullable: true }];
    expect(lintStoryParamSources(declared, (id) => (id === 5 ? 'question' : undefined))).toEqual([]);
  });
});

describe('story-params — render helpers', () => {
  it('reads a param from a placeholder element', () => {
    const el = { getAttribute: (n: string) => ({ 'data-param-name': 'city', 'data-param-type': 'text', 'data-param-nullable': 'false', 'data-param-source-id': '5', 'data-param-source-col': 'region' } as Record<string, string>)[n] ?? null };
    expect(paramFromPlaceholderEl(el)).toEqual({ name: 'city', type: 'text', nullable: false, source: { questionId: 5, column: 'region' } });
  });
  it('maps a StoryParam to a QuestionParameter (source → question source)', () => {
    expect(storyParamToQuestionParameter({ name: 'city', type: 'text', nullable: true, source: { questionId: 5, column: 'region' } }))
      .toEqual({ name: 'city', type: 'text', label: null, source: { type: 'question', id: 5, column: 'region' } });
    expect(storyParamToQuestionParameter({ name: 'n', type: 'number', nullable: true }))
      .toEqual({ name: 'n', type: 'number', label: null, source: null });
  });
});
