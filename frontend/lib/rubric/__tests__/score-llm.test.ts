import { describe, it, expect, vi, beforeEach } from 'vitest';

// scoreFileLLM routes through the shared micro-task runner; mock it to unit-test the judge's
// var-building + JSON parsing (runMicroTask itself is covered in micro-task.test.ts).
vi.mock('@/lib/chat/run-micro-task.server', () => ({ runMicroTask: vi.fn() }));

import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { renderPrompt } from '@/orchestrator/prompts';
import { scoreFileLLM, combineReports } from '../llm/score-llm.server';
import { scoreFileDeterministic } from '../registry';
import { makeDashboard, makeQuestion, makeStory } from './fixtures';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const mockRun = vi.mocked(runMicroTask);
const USER = { userId: 1, email: 'u@example.com', name: 'U', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;

beforeEach(() => mockRun.mockReset());

describe('scoreFileLLM', () => {
  it('does not call the LLM while every file-type checklist is paused', async () => {
    const reports = await Promise.all([
      scoreFileLLM({ fileType: 'question', content: makeQuestion() }, USER),
      scoreFileLLM({ fileType: 'dashboard', content: makeDashboard() }, USER),
      scoreFileLLM({ fileType: 'story', content: makeStory(), screenshotUrl: 'data:image/jpeg;base64,AAAA' }, USER),
      scoreFileLLM({ fileType: 'context', content: {} }, USER),
    ]);
    expect(mockRun).not.toHaveBeenCalled();
    for (const report of reports) {
      expect(report.categories.every((category) => !category.assessed)).toBe(true);
    }
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
    const deterministic = scoreFileDeterministic('story', makeStory());
    const judge = buildJudgeReport();
    const combined = combineReports(deterministic, judge);
    expect(combined.categories.find((c) => c.category === 'clarity')?.score).toBe(5);
    expect(combined.categories.find((c) => c.category === 'aesthetics')?.score).toBe(4); // 5 - 1 warn
  });
});

function buildJudgeReport() {
  return {
    fileType: 'story' as const, overall: 5, grade: 'good' as const,
    categories: [
      { category: 'correctness' as const, weight: 0.5, score: 5, assessed: true, findings: [] },
      { category: 'clarity' as const, weight: 0.35, score: 5, assessed: true, findings: [] },
      { category: 'aesthetics' as const, weight: 0.15, score: 4, assessed: true, findings: [{ ruleId: 'llm.aesthetics-x', category: 'aesthetics' as const, severity: 'warn' as const, title: 't', detail: 'd', fix: 'f', source: 'llm' as const }] },
    ],
  };
}
