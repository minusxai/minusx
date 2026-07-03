import { describe, it, expect } from 'vitest';
import { passedChecks } from '../checks';
import { scoreFileDeterministic } from '../registry';
import { makeQuestion } from './fixtures';

describe('passedChecks', () => {
  it('lists checks that did not fire and excludes the ones that did', () => {
    const report = scoreFileDeterministic('question', makeQuestion({ query: 'SELECT * FROM t WHERE d > :start', parameters: [] }));
    const ids = passedChecks('question', report, false).map((c) => c.ruleId);
    expect(ids).not.toContain('question.undeclared-param'); // fired → not "passed"
    expect(ids).toContain('question.query-too-long');       // passed
    expect(ids).toContain('question.no-description');
  });

  it('excludes checks from unassessed categories (no aesthetics for a question)', () => {
    const cats = new Set(passedChecks('question', scoreFileDeterministic('question', makeQuestion()), false).map((c) => c.category));
    expect(cats.has('aesthetics')).toBe(false);
  });

  it('includes LLM checks as passed only when the LLM ran', () => {
    const base = scoreFileDeterministic('question', makeQuestion());
    expect(passedChecks('question', base, false).some((c) => c.ruleId.startsWith('llm.'))).toBe(false);

    // simulate the LLM having run (all categories assessed)
    const combined = { ...base, categories: base.categories.map((c) => ({ ...c, assessed: true, score: c.score ?? 5 })) };
    const ids = passedChecks('question', combined, true).map((c) => c.ruleId);
    expect(ids).toContain('llm.chart-type-fit'); // an LLM check that didn't fire → shown as passed
  });
});
