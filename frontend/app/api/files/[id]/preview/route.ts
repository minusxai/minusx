import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { loadFile, setStoryPreview } from '@/lib/data/files.server';
import { validateFileId } from '@/lib/data/helpers/validation';
import { composeStoryCard } from '@/lib/og/og-image';
import { ogCacheKey, truncate } from '@/lib/og/og-helpers';
import { createObjectStore } from '@/lib/object-store';
import type { StoryContent } from '@/lib/types';

// Compose + store a story's social share card from a client-captured screenshot. Called
// when a story is made public (or the preview is refreshed). The composed card is stored
// once and served directly as og:image — there's no on-crawl rendering.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/files/[id]/preview — body: { screenshot: <data URL> }. Returns { url }. */
export const POST = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const id = validateFileId((await params).id);
    const body = await request.json().catch(() => ({}));
    const screenshot = typeof body?.screenshot === 'string' ? body.screenshot : null;
    if (!screenshot || !screenshot.startsWith('data:')) {
      return ApiErrors.validationError('screenshot data URL is required');
    }

    const { data: file } = await loadFile(id, user); // access-checked
    if (file.type !== 'story') return ApiErrors.validationError('Only stories have share previews');
    const tone = (file.content as StoryContent | null)?.colorMode === 'dark' ? 'light' : 'dark';

    const card = await composeStoryCard(screenshot, truncate(file.name, 90), tone);
    const key = ogCacheKey(file.id, file.updated_at);
    await createObjectStore().put(key, card, 'image/png');
    await setStoryPreview(id, user, key);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
});
