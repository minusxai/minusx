import { describe, it, expect } from 'vitest';
import { scoreContext, MAX_DOC_TOKENS } from '../deterministic/context';
import { makeContext } from './fixtures';

const ids = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);

describe('scoreContext', () => {
  it('flags a doc over the token limit as an error', () => {
    const bigDoc = { content: 'x'.repeat((MAX_DOC_TOKENS + 50) * 4), title: 'Big', description: 'd', childPaths: null, draft: null, alwaysInclude: null };
    const f = scoreContext(makeContext({ docs: [bigDoc] })).find((x) => x.ruleId === 'context.doc-too-long');
    expect(f?.severity).toBe('error');
  });

  it('flags an empty context (no docs, metrics, or annotations)', () => {
    const f = scoreContext(makeContext({ docs: [], metrics: null, annotations: null })).find((x) => x.ruleId === 'context.empty');
    expect(f?.severity).toBe('warn');
  });

  it('flags a metric without SQL', () => {
    const findings = scoreContext(makeContext({ metrics: [{ name: 'x', description: 'd', sql: null, connection: null, schema: null, table: null }] }));
    expect(findings.find((x) => x.ruleId === 'context.metric-no-sql')?.severity).toBe('warn');
  });

  it('tags findings with source "rule"', () => {
    const f = scoreContext(makeContext({ docs: [], metrics: null, annotations: null }))[0];
    expect(f.source).toBe('rule');
  });

  it('returns no findings for a healthy context', () => {
    expect(ids(scoreContext(makeContext()))).toEqual([]);
  });
});
