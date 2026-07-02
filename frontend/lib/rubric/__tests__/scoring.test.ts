import { describe, it, expect } from 'vitest';
import { buildReport, gradeFor, scoreCategory } from '../scoring';
import { scoreFileDeterministic } from '../registry';
import { makeQuestion } from './fixtures';
import type { RubricFinding } from '../types';

const f = (severity: RubricFinding['severity']): RubricFinding => ({
  ruleId: 'x', category: 'correctness', severity, title: 't', detail: 'd', fix: 'f',
});

describe('scoring (1–5 scale)', () => {
  it('deducts by severity from 5 (error 2, warn 1)', () => {
    expect(scoreCategory('correctness', 0.45, [f('error'), f('warn')]).score).toBe(2);
  });

  it('rounds to the nearest half (one info → 4.5)', () => {
    expect(scoreCategory('clarity', 0.25, [f('info')]).score).toBe(4.5);
  });

  it('floors a category at 1', () => {
    expect(scoreCategory('correctness', 0.45, [f('error'), f('error'), f('error')]).score).toBe(1);
  });

  it('weights category scores into the overall (question weights)', () => {
    // correctness 2*.5 + clarity 5*.35 + aesthetics 5*.15 = 3.5
    const report = buildReport('question', 'deterministic', [f('error'), f('warn')]);
    expect(report.categories.find((c) => c.category === 'correctness')?.score).toBe(2);
    expect(report.overall).toBe(3.5);
    expect(report.grade).toBe('fair');
  });

  it('scores a clean file at 5 / good with all three categories present (priority order)', () => {
    const report = buildReport('story', 'deterministic', []);
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
    expect(report.source).toBe('deterministic');
    expect(report.fileType).toBe('question');
    expect(report.overall).toBe(5);
  });
});
