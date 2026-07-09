import { describe, it, expect } from 'vitest';
import { formatChecklist, passedChecks, LLM_CHECKS } from '../checks';
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

// Error-severity LLM checks gate the overall score to 0, so the judge must be able to decide
// them OBJECTIVELY — the checklist tells it each check's severity, and every error check's
// pass-condition demands a pointable defect, never a taste call.
describe('LLM checklist severity discipline', () => {
  it('formatChecklist tags every check with its severity', () => {
    const out = formatChecklist('story');
    expect(out).toContain('[aesthetics, error]');
    expect(out).toContain('[aesthetics, warn]');
  });

  it('harmonious-chart-body is taste-level — warn, not a gate', () => {
    expect(LLM_CHECKS.story.find((c) => c.id === 'harmonious-chart-body')?.severity).toBe('warn');
  });

  it('every error-severity check demands a pointable defect (no judgment calls)', () => {
    for (const checks of Object.values(LLM_CHECKS)) {
      for (const c of checks) {
        if (c.severity !== 'error') continue;
        expect(c.question, `${c.id} must tell the judge to only fail on a specific, pointable defect`).toMatch(/point/i);
      }
    }
  });

  it('evidence-supports-claims does not fail on subjective wording', () => {
    const q = LLM_CHECKS.story.find((c) => c.id === 'evidence-supports-claims')?.question ?? '';
    expect(q).toMatch(/subjective/i);
  });
});
