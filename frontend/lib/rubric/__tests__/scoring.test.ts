import { describe, it, expect } from 'vitest';
import { buildReport, gradeFor, scoreCategory, CATEGORY_WEIGHTS, DEFAULT_WARN_DEDUCTION, MAX_SCORE, MIN_SCORE } from '../scoring';
import { scoreFileDeterministic } from '../registry';
import { makeQuestion } from './fixtures';
import type { RubricCategory, RubricFileType, RubricFinding } from '../types';

const f = (severity: RubricFinding['severity'], deduction?: number): RubricFinding => ({
  ruleId: 'x', category: 'correctness', severity, title: 't', detail: 'd', fix: 'f', source: 'rule',
  ...(deduction !== undefined ? { deduction } : {}),
});

const half = (x: number) => Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(x * 2) / 2));

// Expected values derived from the LIVE constants, so these formula tests survive tuning of the
// deductions/weights (which are actively being calibrated).
const catScore = (findings: RubricFinding[]) =>
  half(MAX_SCORE - findings.reduce((s, x) => s + (x.deduction ?? DEFAULT_WARN_DEDUCTION), 0));

function expectedOverall(type: RubricFileType, scores: Partial<Record<RubricCategory, number>>): number {
  const w = CATEGORY_WEIGHTS[type];
  const keys = Object.keys(scores) as RubricCategory[];
  const totalWeight = keys.reduce((s, k) => s + w[k], 0);
  return half(keys.reduce((s, k) => s + (scores[k] as number) * w[k], 0) / totalWeight);
}

describe('scoring (0–5 scale, error = gate)', () => {
  it('an error zeroes its category regardless of other findings', () => {
    expect(scoreCategory('correctness', 0.45, [f('error')]).score).toBe(MIN_SCORE);
    expect(scoreCategory('correctness', 0.45, [f('error'), f('warn')]).score).toBe(MIN_SCORE);
  });

  it('ANY error gates the overall to 0 / poor, even with other clean categories', () => {
    const report = buildReport('question', [f('error')]);
    expect(report.overall).toBe(0);
    expect(report.grade).toBe('poor');
    // the other categories still report their own (clean) scores
    expect(report.categories.find((c) => c.category === 'clarity')?.score).toBe(5);
  });

  it('warn findings deduct their per-finding weight (default 1)', () => {
    expect(scoreCategory('correctness', 0.45, [f('warn')]).score).toBe(MAX_SCORE - DEFAULT_WARN_DEDUCTION);
    expect(scoreCategory('correctness', 0.45, [f('warn', 0.25)]).score).toBe(catScore([f('warn', 0.25)]));
    expect(scoreCategory('correctness', 0.45, [f('warn', 0.25), f('warn', 0.5), f('warn')]).score)
      .toBe(catScore([f('warn', 0.25), f('warn', 0.5), f('warn')]));
  });

  it('rounds to the nearest half', () => {
    // 5 − 0.25 = 4.75 → rounds to 5 (a single lightest warning barely moves the needle)
    expect(scoreCategory('clarity', 0.25, [f('warn', 0.25)]).score).toBe(5);
    // 5 − 3×0.25 = 4.25 → 4.5
    expect(scoreCategory('clarity', 0.25, [f('warn', 0.25), f('warn', 0.25), f('warn', 0.25)]).score).toBe(4.5);
  });

  it('floors a category at MIN_SCORE under many warns', () => {
    expect(scoreCategory('correctness', 0.45, Array.from({ length: 6 }, () => f('warn'))).score).toBe(MIN_SCORE);
  });

  it('weights category warn scores into the overall (no errors present)', () => {
    const cScore = catScore([f('warn'), f('warn', 0.5)]);
    const report = buildReport('question', [f('warn'), f('warn', 0.5)]);
    expect(report.categories.find((c) => c.category === 'correctness')?.score).toBe(cScore);
    const expected = expectedOverall('question', { correctness: cScore, clarity: 5, aesthetics: 5 });
    expect(report.overall).toBe(expected);
    expect(report.grade).toBe(gradeFor(expected));
  });

  it('scores a clean file at 5 / good with all three categories present (priority order)', () => {
    const report = buildReport('story', []);
    expect(report.overall).toBe(5);
    expect(report.grade).toBe('good');
    expect(report.categories.map((c) => c.category)).toEqual(['correctness', 'clarity', 'aesthetics']);
  });

  it('applies grade bands at the boundaries', () => {
    expect(gradeFor(4)).toBe('good');
    expect(gradeFor(3.5)).toBe('fair');
    expect(gradeFor(2.5)).toBe('fair');
    expect(gradeFor(2)).toBe('poor');
  });

  it('registry builds a deterministic report for a supported type', () => {
    const report = scoreFileDeterministic('question', makeQuestion());
    expect(report.fileType).toBe('question');
    expect(report.overall).toBe(5);
  });

  it('marks unassessed categories (deterministic aesthetics on a question) as not-scored', () => {
    const report = scoreFileDeterministic('question', makeQuestion());
    const aesthetics = report.categories.find((c) => c.category === 'aesthetics');
    expect(aesthetics?.assessed).toBe(false);
    expect(aesthetics?.score).toBeNull();
    // stories DO assess aesthetics deterministically (palette rules)
    const storyAesthetics = scoreFileDeterministic('story', { description: 'x', story: '<div><style>{`.s{font-family:Inter;color:#111;background:#fff} .a{color:#2563eb}`}</style><h1>H</h1><Question id={1}/></div>' })
      .categories.find((c) => c.category === 'aesthetics');
    expect(storyAesthetics?.assessed).toBe(true);
  });

  it('renormalizes the overall over only the assessed categories (warns only)', () => {
    const report = buildReport('question', [f('warn')], ['correctness', 'clarity']);
    expect(report.categories.find((c) => c.category === 'aesthetics')?.score).toBeNull();
    expect(report.overall).toBe(expectedOverall('question', { correctness: catScore([f('warn')]), clarity: 5 }));
  });

  it('the error gate also applies when the erroring category is among the assessed subset', () => {
    const report = buildReport('question', [f('error')], ['correctness', 'clarity']);
    expect(report.overall).toBe(0);
    expect(report.grade).toBe('poor');
  });
});
