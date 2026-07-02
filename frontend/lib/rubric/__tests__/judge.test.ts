import { describe, it, expect } from 'vitest';
import { judgeFile, combineReports, SubmitRubric } from '../judge/judge.server';
import { scoreFileDeterministic } from '../registry';
import type { AssistantMessage } from '@/orchestrator/llm';
import { makeQuestion } from './fixtures';

/** Minimal AssistantMessage carrying a single SubmitRubric tool call. */
function withFindings(findings: unknown[]): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id: 't1', name: SubmitRubric.name, arguments: { findings } }],
    api: 'anthropic' as never, provider: 'x', model: 'x',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'toolUse', timestamp: 0,
  };
}

describe('judgeFile', () => {
  it('maps SubmitRubric findings into a scored llm-judge report', async () => {
    const msg = withFindings([
      { category: 'aesthetics', severity: 'warn', title: 'Generic palette', detail: 'purple gradient', fix: 'Pick a protagonist accent.' },
    ]);
    const report = await judgeFile({ fileType: 'question', content: makeQuestion() }, async () => msg);
    expect(report.source).toBe('llm-judge');
    expect(report.categories.find((c) => c.category === 'aesthetics')?.findings[0]?.title).toBe('Generic palette');
    expect(report.categories.find((c) => c.category === 'aesthetics')?.score).toBe(4); // one warn: 5-1
  });

  it('scores a clean judgment at 100', async () => {
    const report = await judgeFile({ fileType: 'story', content: { description: 'x', story: '<div/>' } }, async () => withFindings([]));
    expect(report.overall).toBe(5);
  });

  it('returns an empty report when the model does not call SubmitRubric', async () => {
    const textOnly = { ...withFindings([]), content: [{ type: 'text', text: 'hi' }] } as AssistantMessage;
    const report = await judgeFile({ fileType: 'question', content: makeQuestion() }, async () => textOnly);
    expect(report.overall).toBe(5);
  });

  it('drops malformed findings (missing category)', async () => {
    const report = await judgeFile({ fileType: 'question', content: makeQuestion() }, async () => withFindings([{ severity: 'error', title: 'x' }]));
    expect(report.overall).toBe(5);
  });
});

describe('combineReports', () => {
  it('merges deterministic and judge findings into one combined report', () => {
    const deterministic = scoreFileDeterministic('question', makeQuestion({ description: '' })); // 1 info (no-description)
    const judge = buildJudgeReport();
    const combined = combineReports(deterministic, judge);
    expect(combined.source).toBe('combined');
    // clarity carries the deterministic info (5-0.5=4.5), aesthetics carries the judge warn (5-1=4)
    expect(combined.categories.find((c) => c.category === 'clarity')?.score).toBe(4.5);
    expect(combined.categories.find((c) => c.category === 'aesthetics')?.score).toBe(4);
  });
});

function buildJudgeReport() {
  // aesthetics warn → aesthetics 4
  return {
    fileType: 'question' as const, source: 'llm-judge' as const, overall: 5, grade: 'good' as const,
    categories: [
      { category: 'correctness' as const, weight: 0.5, score: 5, findings: [] },
      { category: 'clarity' as const, weight: 0.35, score: 5, findings: [] },
      { category: 'aesthetics' as const, weight: 0.15, score: 4, findings: [{ ruleId: 'judge.aesthetics.0', category: 'aesthetics' as const, severity: 'warn' as const, title: 't', detail: 'd', fix: 'f' }] },
    ],
  };
}
