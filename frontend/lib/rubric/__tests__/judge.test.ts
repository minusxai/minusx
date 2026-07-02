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
      { category: 'craft', severity: 'warn', title: 'Generic palette', detail: 'purple gradient', fix: 'Pick a protagonist accent.' },
    ]);
    const report = await judgeFile({ fileType: 'question', content: makeQuestion() }, async () => msg);
    expect(report.source).toBe('llm-judge');
    expect(report.categories.find((c) => c.category === 'craft')?.findings[0]?.title).toBe('Generic palette');
    expect(report.categories.find((c) => c.category === 'craft')?.score).toBe(90); // one warn
  });

  it('scores a clean judgment at 100', async () => {
    const report = await judgeFile({ fileType: 'story', content: { description: 'x', story: '<div/>' } }, async () => withFindings([]));
    expect(report.overall).toBe(100);
  });

  it('returns an empty report when the model does not call SubmitRubric', async () => {
    const textOnly = { ...withFindings([]), content: [{ type: 'text', text: 'hi' }] } as AssistantMessage;
    const report = await judgeFile({ fileType: 'question', content: makeQuestion() }, async () => textOnly);
    expect(report.overall).toBe(100);
  });

  it('drops malformed findings (missing category)', async () => {
    const report = await judgeFile({ fileType: 'question', content: makeQuestion() }, async () => withFindings([{ severity: 'error', title: 'x' }]));
    expect(report.overall).toBe(100);
  });
});

describe('combineReports', () => {
  it('merges deterministic and judge findings into one combined report', () => {
    const deterministic = scoreFileDeterministic('question', makeQuestion({ description: '' })); // 1 info (no-description)
    const judge = buildJudgeReport();
    const combined = combineReports(deterministic, judge);
    expect(combined.source).toBe('combined');
    // clarity carries the deterministic info (-3), craft carries the judge warn (-10)
    expect(combined.categories.find((c) => c.category === 'clarity')?.score).toBe(97);
    expect(combined.categories.find((c) => c.category === 'craft')?.score).toBe(90);
  });
});

function buildJudgeReport() {
  // craft warn → craft 90
  return {
    fileType: 'question' as const, source: 'llm-judge' as const, overall: 98, grade: 'good' as const,
    categories: [
      { category: 'clarity' as const, weight: 0.3, score: 100, findings: [] },
      { category: 'correctness' as const, weight: 0.5, score: 100, findings: [] },
      { category: 'craft' as const, weight: 0.2, score: 90, findings: [{ ruleId: 'judge.craft.0', category: 'craft' as const, severity: 'warn' as const, title: 't', detail: 'd', fix: 'f' }] },
    ],
  };
}
