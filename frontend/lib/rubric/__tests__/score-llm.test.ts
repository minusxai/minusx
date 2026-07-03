import { describe, it, expect, vi, beforeEach } from 'vitest';

// scoreFileLLM routes through the shared micro-task runner; mock it to unit-test the judge's
// var-building + JSON parsing (runMicroTask itself is covered in micro-task.test.ts).
vi.mock('@/lib/chat/run-micro-task.server', () => ({ runMicroTask: vi.fn() }));

import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { renderPrompt } from '@/orchestrator/prompts';
import { scoreFileLLM, combineReports } from '../llm/score-llm.server';
import { scoreFileDeterministic } from '../registry';
import { makeQuestion, makeStory } from './fixtures';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const mockRun = vi.mocked(runMicroTask);
const USER = { userId: 1, email: 'u@example.com', name: 'U', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;
const reply = (checks: unknown[]) => JSON.stringify({ checks });

beforeEach(() => mockRun.mockReset());

describe('scoreFileLLM', () => {
  it('runs the rubric_llm micro-task with the checklist + screenshot and turns FAILS into findings', async () => {
    mockRun.mockResolvedValue(reply([
      { id: 'chart-type-fit', pass: false, reason: 'a pie chart is used for a time trend' },
      { id: 'axes-labeled', pass: true, reason: 'axes titled with units' },
    ]));
    const report = await scoreFileLLM({ fileType: 'question', content: makeQuestion(), screenshotUrl: 'data:image/jpeg;base64,AAAA' }, USER);

    // routed through the shared runner with the checklist var + image
    const [taskKey, vars, user, images] = mockRun.mock.calls[0];
    expect(taskKey).toBe('rubric_llm');
    expect(vars.checklist).toContain('chart-type-fit');
    expect(vars.markup).toContain('SELECT');
    expect(user).toBe(USER);
    expect(images?.[0]).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' });

    // the failed check → a finding using the catalog's category/severity/label/fix, tagged source llm
    const f = report.categories.flatMap((c) => c.findings).find((x) => x.ruleId === 'llm.chart-type-fit');
    expect(f?.source).toBe('llm');
    expect(f?.severity).toBe('error');
    expect(f?.category).toBe('correctness');
    expect(f?.title).toBe('Right chart for the data');
    expect(f?.detail).toContain('pie');
    expect(report.overall).toBeLessThan(5);
  });

  it('scores an all-pass checklist at 5', async () => {
    mockRun.mockResolvedValue(reply([{ id: 'chart-type-fit', pass: true, reason: 'ok' }]));
    expect((await scoreFileLLM({ fileType: 'question', content: makeQuestion() }, USER)).overall).toBe(5);
  });

  it('ignores unknown ids and applicable:false checks', async () => {
    mockRun.mockResolvedValue(reply([
      { id: 'not-a-real-check', pass: false, reason: 'x' },
      { id: 'honest-scale', applicable: false, pass: false, reason: 'no numeric axis' },
    ]));
    expect((await scoreFileLLM({ fileType: 'question', content: makeQuestion() }, USER)).overall).toBe(5);
  });

  it('returns an empty report when the reply is not valid JSON', async () => {
    mockRun.mockResolvedValue('I could not review this.');
    expect((await scoreFileLLM({ fileType: 'question', content: makeQuestion() }, USER)).overall).toBe(5);
  });

  it('turns a failed story embed-rendering check into a finding', async () => {
    mockRun.mockResolvedValue(reply([
      { id: 'embeds-well-sized', pass: false, reason: 'the single_value floats in a large empty box' },
      { id: 'charts-render-cleanly', pass: true, reason: 'ok' },
    ]));
    const report = await scoreFileLLM({ fileType: 'story', content: makeStory(), screenshotUrl: 'data:image/jpeg;base64,AAAA' }, USER);
    const f = report.categories.flatMap((c) => c.findings).find((x) => x.ruleId === 'llm.embeds-well-sized');
    expect(f?.source).toBe('llm');
    expect(f?.detail).toContain('empty box');
  });
});

describe('rubric_llm prompt', () => {
  // The prompt embeds a literal JSON example; its braces must be escaped ({{ }}) so pyFormat
  // doesn't read them as {variables}. This test guards that regression.
  it('renders without missing-variable errors (literal JSON braces escaped)', () => {
    expect(() => renderPrompt('micro.rubric_llm.system', { file_type: 'question', checklist: '- chart-type-fit [correctness]: ...' })).not.toThrow();
    // markup value itself contains braces (story JSX) — inserted verbatim, must not re-parse
    expect(() => renderPrompt('micro.rubric_llm.user', {
      file_type: 'question', markup: '<query>{`SELECT {a}`}</query>', screenshot_note: 'none',
    })).not.toThrow();
  });

  it('keeps the JSON shape literal in the rendered system prompt', () => {
    const out = renderPrompt('micro.rubric_llm.system', { file_type: 'question', checklist: '' });
    expect(out).toContain('{"checks":[{"id"');
  });
});

describe('combineReports', () => {
  it('merges deterministic and judge findings into one combined report', () => {
    const deterministic = scoreFileDeterministic('question', makeQuestion({ description: '' })); // clarity info (no-description)
    const judge = buildJudgeReport();
    const combined = combineReports(deterministic, judge);
    expect(combined.categories.find((c) => c.category === 'clarity')?.score).toBe(4.5); // 5 - 0.5 info
    expect(combined.categories.find((c) => c.category === 'aesthetics')?.score).toBe(4); // 5 - 1 warn
  });
});

function buildJudgeReport() {
  return {
    fileType: 'question' as const, overall: 5, grade: 'good' as const,
    categories: [
      { category: 'correctness' as const, weight: 0.5, score: 5, assessed: true, findings: [] },
      { category: 'clarity' as const, weight: 0.35, score: 5, assessed: true, findings: [] },
      { category: 'aesthetics' as const, weight: 0.15, score: 4, assessed: true, findings: [{ ruleId: 'llm.aesthetics-x', category: 'aesthetics' as const, severity: 'warn' as const, title: 't', detail: 'd', fix: 'f', source: 'llm' as const }] },
    ],
  };
}
