/**
 * reviewFile on a MID-LOAD capture (staging overcorrection, Jul 2026): after an EditFile the
 * story iframe remounts and every embed query re-runs; when the readiness wait times out, the
 * screenshot shows loading/blank cards. The agent — and the LLM visual judge grading that same
 * screenshot — read those as broken embeds, and the agent deletes healthy content ("I removed
 * them as an overcorrection after the story preview intermittently showed those embedded charts
 * as loading/blank during my review", its own words).
 *
 * The contract under test:
 *  - unsettled capture → the visual judge is NOT called (it would grade spinner pixels),
 *    the rubric degrades to rules-only, and `renderPending` carries an explicit LLM-facing
 *    note that the blanks are capture timing, not breakage;
 *  - settled capture → the full judge path runs exactly as before, with no note.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const seams = vi.hoisted(() => ({
  readiness: { settled: true, busyCount: 0 },
  getRubric: vi.fn(),
}));

vi.mock('@/lib/screenshot/capture', () => ({
  captureFileViewWithReadiness: vi.fn(async () => ({
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    readiness: seams.readiness,
  })),
}));
vi.mock('@/lib/object-store/client', () => ({
  uploadBlobOrEmbed: vi.fn(async () => 'mock://shot.jpg'),
}));
vi.mock('@/lib/data/files', () => ({
  FilesAPI: { getRubric: seams.getRubric },
}));
vi.mock('@/store/store', () => ({
  getStore: () => ({ getState: () => ({}) }),
}));
vi.mock('@/store/filesSlice', () => ({
  selectFile: () => ({ type: 'story' }),
  selectMergedContent: () => ({ story: '<div/>' }),
}));
vi.mock('@/lib/rubric/registry', () => ({
  isRubricFileType: () => true,
  // deterministicAgentRubric swallows this and returns undefined — rules-only degrade path.
  scoreFileDeterministic: () => { throw new Error('not scorable in this test'); },
}));

import { reviewFile } from '../file-review';

describe('reviewFile — mid-load capture handling', () => {
  beforeEach(() => {
    seams.getRubric.mockReset();
    seams.getRubric.mockResolvedValue({ report: { score: 5, findings: [] } });
  });

  it('skips the visual judge and returns an explicit renderPending note when the view never settled', async () => {
    seams.readiness = { settled: false, busyCount: 3 };
    const review = await reviewFile(42, { colorMode: 'light' });
    expect(seams.getRubric).not.toHaveBeenCalled();
    expect(review.reviewMode).toBe('deterministic');
    expect(review.screenshotUrl).toBe('mock://shot.jpg');
    expect(review.renderPending).toMatch(/still\s+loading/i);
    expect(review.renderPending).toMatch(/3 embed/);
    expect(review.renderPending).toMatch(/not\s+broken|NOT\s+remove|do NOT remove/i);
  });

  it('runs the full judge path with no note when the view settled', async () => {
    seams.readiness = { settled: true, busyCount: 0 };
    const review = await reviewFile(42, { colorMode: 'light' });
    expect(seams.getRubric).toHaveBeenCalledTimes(1);
    expect(review.renderPending).toBeUndefined();
  });
});
