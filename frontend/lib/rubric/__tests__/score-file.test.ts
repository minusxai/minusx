import { describe, it, expect, vi, beforeEach } from 'vitest';

// scoreFile (piece 3) runs on the server: it must resolve referenced-question viz types (via
// loadFile) so its DETERMINISTIC half matches the client badge — otherwise a width finding that
// fires client-side vanishes the moment visual review runs. Mock the two server deps.
vi.mock('@/lib/chat/run-micro-task.server', () => ({ runMicroTask: vi.fn().mockResolvedValue('{"checks":[]}') }));
vi.mock('@/lib/data/files.server', () => ({ loadFile: vi.fn() }));

import { loadFile } from '@/lib/data/files.server';
import { scoreFile } from '../score-file.server';
import { makeStory } from './fixtures';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const mockLoad = vi.mocked(loadFile);
const USER = { userId: 1, email: 'u@example.com', name: 'U', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;

// A story (stored placeholder form) with 3 saved embeds packed into a repeat(3,1fr) grid.
const STYLE = '<style>.g{display:grid;grid-template-columns:repeat(3,1fr)} .s{font-family:Inter;color:#111} h1{color:#2563eb} .a{color:#f59e0b}</style>';
const q = (id: number) => `<div data-question-id="${id}" style="width:100%;height:430px"></div>`;
const narrowStory = makeStory({ story: `<div class="s">${STYLE}<h1>T</h1><div class="g">${q(1)}${q(2)}${q(3)}</div></div>` });

beforeEach(() => mockLoad.mockReset());

describe('scoreFile — deterministic half resolves referenced viz types', () => {
  it('keeps the embed-too-narrow finding when the referenced questions are cartesian', async () => {
    mockLoad.mockResolvedValue({ data: { content: { vizSettings: { type: 'bar' } } } } as unknown as Awaited<ReturnType<typeof loadFile>>);
    const report = await scoreFile('story', narrowStory, USER);
    const ruleIds = report.categories.flatMap((c) => c.findings).map((f) => f.ruleId);
    expect(ruleIds).toContain('story.embed-too-narrow');
  });
});
