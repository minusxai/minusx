/**
 * ReviewFile handler wiring: when the review reports a mid-load capture (`renderPending`),
 * the note must land in the LLM-visible status payload (`renderNote`) alongside the screenshot —
 * a screenshot of loading embeds WITHOUT the note is exactly what caused the staging
 * overcorrection (the agent deleted healthy embeds it saw as blank).
 */
import { describe, it, expect, vi } from 'vitest';

const reviewFileMock = vi.hoisted(() => vi.fn());
vi.mock('../file-review', () => ({ reviewFile: reviewFileMock }));

import { reviewFileHandler } from '../review-file';

type Block = { type: string; text?: string; image_url?: { url: string } };
const blocksOf = (r: { content: unknown }): Block[] => r.content as Block[];

describe('ReviewFile handler — renderNote wiring', () => {
  it('surfaces renderPending as renderNote in the status text', async () => {
    reviewFileMock.mockResolvedValue({
      rubric: { score: 4 },
      screenshotUrl: 'mock://shot.jpg',
      reviewMode: 'deterministic',
      renderPending: 'Screenshot captured before the view finished rendering — 2 embed(s) were still loading.',
    });
    const result = await reviewFileHandler({ fileId: 7 }, { state: { ui: { colorMode: 'light' } } } as never);
    const status = JSON.parse(blocksOf(result)[0].text ?? '{}');
    expect(status.renderNote).toMatch(/still loading/);
    expect(blocksOf(result).some((c) => c.type === 'image_url')).toBe(true);
  });

  it('omits renderNote for a settled review', async () => {
    reviewFileMock.mockResolvedValue({ rubric: { score: 4 }, screenshotUrl: 'mock://shot.jpg', reviewMode: 'full' });
    const result = await reviewFileHandler({ fileId: 7 }, { state: { ui: { colorMode: 'light' } } } as never);
    const status = JSON.parse(blocksOf(result)[0].text ?? '{}');
    expect(status.renderNote).toBeUndefined();
  });
});
