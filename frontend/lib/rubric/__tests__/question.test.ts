import { describe, it, expect } from 'vitest';
import { scoreQuestion } from '../deterministic/question';
import type { QuestionParameter } from '@/lib/types';
import { makeQuestion, makeViz } from './fixtures';

const ids = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);
const param = (name: string): QuestionParameter => ({ name, type: 'text', label: null, source: null });

describe('scoreQuestion', () => {
  it('flags an oversized query (warn > 400 tokens, error > 800)', () => {
    const warn = scoreQuestion(makeQuestion({ query: 'x'.repeat(1700) })); // ~425 tokens
    const f = warn.find((x) => x.ruleId === 'question.query-too-long');
    expect(f?.severity).toBe('warn');

    const error = scoreQuestion(makeQuestion({ query: 'x'.repeat(3300) })); // ~825 tokens
    expect(error.find((x) => x.ruleId === 'question.query-too-long')?.severity).toBe('error');
  });

  it('does not flag a query just under the warn threshold', () => {
    const findings = scoreQuestion(makeQuestion({ query: 'x'.repeat(1500) })); // ~375 tokens
    expect(ids(findings)).not.toContain('question.query-too-long');
  });

  it('flags a :token referenced in SQL but not declared', () => {
    const findings = scoreQuestion(makeQuestion({
      query: 'SELECT * FROM t WHERE d > :start',
      parameters: null,
    }));
    const f = findings.find((x) => x.ruleId === 'question.undeclared-param');
    expect(f?.severity).toBe('error');
    expect(f?.detail).toContain('start');
  });

  it('does not flag ::type casts as undeclared params', () => {
    const findings = scoreQuestion(makeQuestion({
      query: "SELECT id::text FROM t WHERE ts > now()",
      parameters: null,
    }));
    expect(ids(findings)).not.toContain('question.undeclared-param');
  });

  it('flags a declared parameter that is never used', () => {
    const findings = scoreQuestion(makeQuestion({
      query: 'SELECT * FROM t',
      parameters: [param('limit')],
    }));
    const unused = findings.find((x) => x.ruleId === 'question.unused-param');
    expect(unused?.severity).toBe('warn');
    expect(unused?.deduction).toBe(0.25);
  });

  it('flags a pivot with no pivotConfig, but not a configured one', () => {
    const bad = scoreQuestion(makeQuestion({ vizSettings: makeViz({ type: 'pivot', pivotConfig: null }) }));
    expect(bad.find((x) => x.ruleId === 'question.viz-config-incomplete')?.severity).toBe('error');

    const good = scoreQuestion(makeQuestion({
      vizSettings: makeViz({ type: 'pivot', pivotConfig: { rows: ['region'], columns: [], values: [{ column: 'revenue' }] } }),
    }));
    expect(ids(good)).not.toContain('question.viz-config-incomplete');
  });

  it('flags a pie with more than one measure', () => {
    const findings = scoreQuestion(makeQuestion({ vizSettings: makeViz({ type: 'pie', yCols: ['a', 'b'] }) }));
    expect(findings.find((x) => x.ruleId === 'question.pie-multi-measure')?.severity).toBe('warn');
  });

  it('flags a line chart with more than 5 series', () => {
    const findings = scoreQuestion(makeQuestion({
      vizSettings: makeViz({ type: 'line', yCols: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    }));
    expect(findings.find((x) => x.ruleId === 'question.too-many-series')?.severity).toBe('warn');
  });

  it('returns no findings for a healthy question', () => {
    expect(scoreQuestion(makeQuestion())).toEqual([]);
  });
});
