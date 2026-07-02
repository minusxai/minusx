import { describe, it, expect } from 'vitest';
import { passedChecks } from '../checks';
import { scoreFileDeterministic } from '../registry';
import { makeQuestion } from './fixtures';

describe('passedChecks', () => {
  it('lists checks that did not fire and excludes the ones that did', () => {
    const report = scoreFileDeterministic('question', makeQuestion({ query: 'SELECT * FROM t WHERE d > :start', parameters: [] }));
    const ids = passedChecks('question', report).map((c) => c.ruleId);
    expect(ids).not.toContain('question.undeclared-param'); // fired → not "passed"
    expect(ids).toContain('question.query-too-long');       // passed
    expect(ids).toContain('question.no-description');
  });

  it('excludes checks from unassessed categories (no aesthetics for a question)', () => {
    const cats = new Set(passedChecks('question', scoreFileDeterministic('question', makeQuestion())).map((c) => c.category));
    expect(cats.has('aesthetics')).toBe(false);
  });
});
