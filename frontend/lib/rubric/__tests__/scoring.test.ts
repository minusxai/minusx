import { describe, it, expect } from 'vitest';
import { buildReport, gradeFor, scoreCategory } from '../scoring';
import { scoreFileDeterministic } from '../registry';
import { makeQuestion } from './fixtures';
import type { RubricFinding } from '../types';

const f = (severity: RubricFinding['severity']): RubricFinding => ({
  ruleId: 'x', category: 'correctness', severity, title: 't', detail: 'd', fix: 'f',
});

describe('scoring', () => {
  it('deducts by severity within a category (error 25, warn 10)', () => {
    const cat = scoreCategory('correctness', 0.5, [f('error'), f('warn')]);
    expect(cat.score).toBe(65);
  });

  it('floors a category at 0', () => {
    expect(scoreCategory('correctness', 0.5, [f('error'), f('error'), f('error'), f('error'), f('error')]).score).toBe(0);
  });

  it('weights category scores into the overall (question weights)', () => {
    // clarity 100*.3 + correctness 65*.5 + craft 100*.2 = 82.5 → 83
    const report = buildReport('question', 'deterministic', [f('error'), f('warn')]);
    expect(report.categories.find((c) => c.category === 'correctness')?.score).toBe(65);
    expect(report.overall).toBe(83);
    expect(report.grade).toBe('good');
  });

  it('scores a clean file at 100 / good with all three categories present', () => {
    const report = buildReport('story', 'deterministic', []);
    expect(report.overall).toBe(100);
    expect(report.grade).toBe('good');
    expect(report.categories.map((c) => c.category)).toEqual(['clarity', 'correctness', 'craft']);
  });

  it('applies grade bands at the boundaries', () => {
    expect(gradeFor(80)).toBe('good');
    expect(gradeFor(79)).toBe('fair');
    expect(gradeFor(50)).toBe('fair');
    expect(gradeFor(49)).toBe('poor');
  });

  it('registry builds a deterministic report for a supported type', () => {
    const report = scoreFileDeterministic('question', makeQuestion());
    expect(report.source).toBe('deterministic');
    expect(report.fileType).toBe('question');
    expect(report.overall).toBe(100);
  });
});
