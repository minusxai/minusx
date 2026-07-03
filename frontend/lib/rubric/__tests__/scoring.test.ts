import { describe, it, expect } from 'vitest';
import { buildReport, gradeFor, scoreCategory, CATEGORY_WEIGHTS, SEVERITY_DEDUCTION, MAX_SCORE, MIN_SCORE } from '../scoring';
import { scoreFileDeterministic } from '../registry';
import { makeQuestion } from './fixtures';
import type { RubricCategory, RubricFileType, RubricFinding } from '../types';

const f = (severity: RubricFinding['severity']): RubricFinding => ({
  ruleId: 'x', category: 'correctness', severity, title: 't', detail: 'd', fix: 'f', source: 'rule',
});

const half = (x: number) => Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(x * 2) / 2));

// Expected values derived from the LIVE constants, so these formula tests survive tuning of the
// deductions/weights (which are actively being calibrated).
const catScore = (findings: RubricFinding[]) =>
  half(MAX_SCORE - findings.reduce((s, x) => s + SEVERITY_DEDUCTION[x.severity], 0));

function expectedOverall(type: RubricFileType, scores: Partial<Record<RubricCategory, number>>): number {
  const w = CATEGORY_WEIGHTS[type];
  const keys = Object.keys(scores) as RubricCategory[];
  const totalWeight = keys.reduce((s, k) => s + w[k], 0);
  return half(keys.reduce((s, k) => s + (scores[k] as number) * w[k], 0) / totalWeight);
}

describe('scoring (0–5 scale)', () => {
  it('deducts by severity from 5 (error > warn > info)', () => {
    expect(scoreCategory('correctness', 0.45, [f('error'), f('warn')]).score).toBe(catScore([f('error'), f('warn')]));
    expect(SEVERITY_DEDUCTION.error).toBeGreaterThan(SEVERITY_DEDUCTION.warn);
    expect(SEVERITY_DEDUCTION.warn).toBeGreaterThan(SEVERITY_DEDUCTION.info);
  });

  it('rounds to the nearest half', () => {
    expect(scoreCategory('clarity', 0.25, [f('info')]).score).toBe(catScore([f('info')]));
  });

  it('floors a category at MIN_SCORE', () => {
    expect(scoreCategory('correctness', 0.45, [f('error'), f('error'), f('error')]).score).toBe(MIN_SCORE);
  });

  it('weights category scores into the overall (all categories assessed)', () => {
    const cScore = catScore([f('error'), f('warn')]);
    const report = buildReport('question', [f('error'), f('warn')]);
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

  it('renormalizes the overall over only the assessed categories', () => {
    // question: correctness error → 3, clarity 5, aesthetics unassessed → excluded from overall.
    const report = buildReport('question', [f('error')], ['correctness', 'clarity']);
    expect(report.categories.find((c) => c.category === 'aesthetics')?.score).toBeNull();
    expect(report.overall).toBe(expectedOverall('question', { correctness: catScore([f('error')]), clarity: 5 }));
  });
});
