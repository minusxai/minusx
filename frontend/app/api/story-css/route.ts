/**
 * POST /api/story-css — preview compile for STAGED story content.
 *
 * The persisted `compiledCss` is computed on save (FilesAPI); a draft staged by an agent
 * EditFile or an in-progress WYSIWYG edit hasn't been saved yet, so the client posts the
 * draft story here and injects the result (useStoryPreviewCss → AgentHtml), making drafts
 * render styled BEFORE save. Same compiler and marker gate as the save path, so preview and
 * persisted CSS can never disagree.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { compileStoryCss } from '@/lib/data/story/story-css.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const body = await request.json().catch(() => null);
    const story = body?.story;
    if (typeof story !== 'string') {
      return ApiErrors.badRequest('story (string) is required');
    }
    // format:'jsx' drafts have no data-design marker (shadcn JSX is design-system by
    // definition) — force the compile so drafts preview styled, same as the save path.
    return successResponse({ css: await compileStoryCss(story, { force: body?.format === 'jsx' }) });
  } catch (error) {
    return handleApiError(error);
  }
});
