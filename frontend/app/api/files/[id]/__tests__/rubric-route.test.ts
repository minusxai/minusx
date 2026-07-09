// POST /api/files/[id]/rubric — the rubric must grade the SAME content the screenshot shows.
// The caller (Screenshot tool / manual visual review) captures the live DOM = merged content
// (saved content + unsaved agent edits), so the body may carry that merged content. When it does,
// the route scores it instead of the stale saved DB snapshot. Without it, it falls back to saved.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER = { userId: 1, email: 'u@example.com', name: 'U', role: 'admin', home_folder: '/org', mode: 'org' };

vi.mock('@/lib/auth/auth-helpers', () => ({ getEffectiveUser: vi.fn() }));
vi.mock('@/lib/data/files.server', () => ({ loadFile: vi.fn() }));
vi.mock('@/lib/rubric/score-file.server', () => ({
  scoreFile: vi.fn(),
  scoreFileDeterministicResolved: vi.fn(),
}));

import { POST } from '@/app/api/files/[id]/rubric/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { loadFile } from '@/lib/data/files.server';
import { scoreFile } from '@/lib/rubric/score-file.server';
import { NextRequest } from 'next/server';

const mockAuth = vi.mocked(getEffectiveUser);
const mockLoad = vi.mocked(loadFile);
const mockScore = vi.mocked(scoreFile);

const SAVED = { description: 'saved', story: '<div>saved</div>' };
const MERGED = { description: 'merged', story: '<div>merged edited</div>' };
const REPORT = { overall: 3, grade: 'fair', categories: [] };

function post(id: number, body: unknown) {
  const req = new NextRequest(`http://localhost/api/files/${id}/rubric`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: String(id) }) } as never);
}

beforeEach(() => {
  mockAuth.mockReset().mockResolvedValue(USER as unknown as Awaited<ReturnType<typeof getEffectiveUser>>);
  mockLoad.mockReset().mockResolvedValue({ data: { type: 'story', content: SAVED } } as unknown as Awaited<ReturnType<typeof loadFile>>);
  mockScore.mockReset().mockResolvedValue(REPORT as unknown as Awaited<ReturnType<typeof scoreFile>>);
});

describe('POST /api/files/[id]/rubric — scores the caller-supplied merged content', () => {
  it('scores body.content (the live/merged view) when provided, not the saved DB content', async () => {
    await post(5, { screenshotUrl: 'https://x/s.jpg', content: MERGED });
    expect(mockScore).toHaveBeenCalledWith('story', MERGED, USER, 'https://x/s.jpg', undefined);
  });

  it('falls back to the saved DB content when no content is supplied', async () => {
    await post(5, { screenshotUrl: 'https://x/s.jpg' });
    expect(mockScore).toHaveBeenCalledWith('story', SAVED, USER, 'https://x/s.jpg', undefined);
  });

  it('ignores a non-object content (e.g. null) and scores saved content', async () => {
    await post(5, { screenshotUrl: 'https://x/s.jpg', content: null });
    expect(mockScore).toHaveBeenCalledWith('story', SAVED, USER, 'https://x/s.jpg', undefined);
  });

  // MEASURED embed widths (real pixels from the caller's rendered iframe) ride along and
  // supersede the static CSS width estimate; malformed entries are dropped, never fatal.
  it('forwards valid measuredEmbeds and drops malformed entries', async () => {
    await post(5, {
      screenshotUrl: 'https://x/s.jpg',
      measuredEmbeds: [
        { vizType: 'line', widthPx: 340, columnPx: 1200 },
        { vizType: 'bar', widthPx: 'oops', columnPx: 1200 },      // non-numeric width → dropped
        { widthPx: 500, columnPx: 0 },                            // zero column → dropped
        { widthPx: 700, columnPx: 1200 },                          // no vizType → kept (typeless)
      ],
    });
    expect(mockScore).toHaveBeenCalledWith('story', SAVED, USER, 'https://x/s.jpg', [
      { vizType: 'line', widthPx: 340, columnPx: 1200 },
      { widthPx: 700, columnPx: 1200 },
    ]);
  });
});
