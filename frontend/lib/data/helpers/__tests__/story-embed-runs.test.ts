// storyEmbedRuns: which queries a story body runs, and with what params. Inline <Number query>
// embeds must bind the story's shared <Param> values (the :names their SQL references) — same as
// inline <Question> — so a reader's slider / the agent's default param flows into the number.
import { describe, it, expect } from 'vitest';
import { storyEmbedRuns, getRootParamsFromContent } from '../param-resolution';
import { numberToPlaceholder } from '@/lib/data/story-number';

describe('getRootParamsFromContent — a story flows its parameterValues (like a dashboard)', () => {
  it('returns a story\'s saved parameterValues as the inherited params', () => {
    expect(getRootParamsFromContent('story', { parameterValues: { min_mrr: 28000 } })).toEqual({ min_mrr: 28000 });
  });
  it('still returns {} for a question (only dashboards/stories cascade params)', () => {
    expect(getRootParamsFromContent('question', { parameterValues: { x: 1 } })).toEqual({});
  });
});

describe('storyEmbedRuns — inline <Number> binds story :params', () => {
  const numQuery = 'SELECT SUM(mrr) AS m FROM t WHERE mrr >= :min_mrr';

  it("binds a number query's :min_mrr to the story param value", () => {
    const html = `<div>${numberToPlaceholder({ query: numQuery, connection: 'duck', col: 'm' })}</div>`;
    const runs = storyEmbedRuns(html, { min_mrr: 28000, unrelated: 'x' });
    // Only the referenced param is bound (so the hash is stable to unrelated params).
    expect(runs).toEqual([{ query: numQuery, connection: 'duck', params: { min_mrr: 28000 } }]);
  });

  it('a number query with no :params runs with {} (unchanged)', () => {
    const html = `<div>${numberToPlaceholder({ query: 'SELECT 1 AS n', connection: 'duck' })}</div>`;
    expect(storyEmbedRuns(html, { min_mrr: 5 })[0].params).toEqual({});
  });

  it('an unbound :param → null (None / no filter)', () => {
    const html = `<div>${numberToPlaceholder({ query: 'SELECT 1 WHERE x >= :ghost', connection: 'duck' })}</div>`;
    expect(storyEmbedRuns(html, {})[0].params).toEqual({ ghost: null });
  });
});
