// Story <Param> declarations round-trip: jsx attrs → StoryParam → placeholder → StoryParam → jsx.
import { describe, it, expect } from 'vitest';
import {
  paramFromJsxAttrs, paramToPlaceholder, paramToJsx, extractStoryParams,
  placeholdersToParamJsx, normalizeParamType, type StoryParam,
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
