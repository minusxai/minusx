import { describe, it, expect, vi, beforeEach } from 'vitest';

// judgeFile routes through the shared micro-task runner; mock it to unit-test the judge's
// var-building + JSON parsing (runMicroTask itself is covered in micro-task.test.ts).
vi.mock('@/lib/chat/run-micro-task.server', () => ({ runMicroTask: vi.fn() }));

import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { judgeFile, combineReports } from '../judge/judge.server';
import { scoreFileDeterministic } from '../registry';
import { makeQuestion } from './fixtures';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const mockRun = vi.mocked(runMicroTask);
const USER = { userId: 1, email: 'u@example.com', name: 'U', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;
const reply = (findings: unknown[]) => JSON.stringify({ findings });

beforeEach(() => mockRun.mockReset());

describe('judgeFile', () => {
  it('runs the rubric_judge micro-task with markup + screenshot and scores its findings', async () => {
    mockRun.mockResolvedValue(reply([
      { category: 'aesthetics', severity: 'warn', title: 'Generic palette', detail: 'purple gradient', fix: 'Pick an accent.' },
    ]));
    const report = await judgeFile({ fileType: 'question', content: makeQuestion(), screenshotUrl: 'data:image/jpeg;base64,AAAA' }, USER);

    // routed through the shared runner, not a bespoke LLM call
    const [taskKey, vars, user, images] = mockRun.mock.calls[0];
    expect(taskKey).toBe('rubric_judge');
    expect(vars.markup).toContain('SELECT');
    expect(user).toBe(USER);
    expect(images?.[0]).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' });

    expect(report.source).toBe('llm-judge');
    expect(report.categories.find((c) => c.category === 'aesthetics')?.findings[0]?.title).toBe('Generic palette');
    expect(report.categories.find((c) => c.category === 'aesthetics')?.score).toBe(4); // one warn: 5-1
  });

  it('scores a clean judgment at 5', async () => {
    mockRun.mockResolvedValue(reply([]));
    expect((await judgeFile({ fileType: 'story', content: { description: 'x', story: '<div/>' } }, USER)).overall).toBe(5);
  });

  it('returns an empty report when the reply is not valid JSON', async () => {
    mockRun.mockResolvedValue('I could not review this.');
    expect((await judgeFile({ fileType: 'question', content: makeQuestion() }, USER)).overall).toBe(5);
  });

  it('drops malformed findings (bad category)', async () => {
    mockRun.mockResolvedValue(reply([{ severity: 'error', title: 'x' }, { category: 'nope', severity: 'error', title: 'y' }]));
    expect((await judgeFile({ fileType: 'question', content: makeQuestion() }, USER)).overall).toBe(5);
  });
});

describe('combineReports', () => {
  it('merges deterministic and judge findings into one combined report', () => {
    const deterministic = scoreFileDeterministic('question', makeQuestion({ description: '' })); // clarity info (no-description)
    const judge = buildJudgeReport();
    const combined = combineReports(deterministic, judge);
    expect(combined.source).toBe('combined');
    expect(combined.categories.find((c) => c.category === 'clarity')?.score).toBe(4.5); // 5 - 0.5 info
    expect(combined.categories.find((c) => c.category === 'aesthetics')?.score).toBe(4); // 5 - 1 warn
  });
});

function buildJudgeReport() {
  return {
    fileType: 'question' as const, source: 'llm-judge' as const, overall: 5, grade: 'good' as const,
    categories: [
      { category: 'correctness' as const, weight: 0.5, score: 5, assessed: true, findings: [] },
      { category: 'clarity' as const, weight: 0.35, score: 5, assessed: true, findings: [] },
      { category: 'aesthetics' as const, weight: 0.15, score: 4, assessed: true, findings: [{ ruleId: 'judge.aesthetics.0', category: 'aesthetics' as const, severity: 'warn' as const, title: 't', detail: 'd', fix: 'f' }] },
    ],
  };
}
