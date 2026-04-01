import { withAuth } from '@/lib/api/with-auth';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { notifyInternal } from '@/lib/messaging/internal-notifier';

/**
 * POST /api/capture-error
 * Receives frontend error reports and forwards them to the internal Slack channel.
 * The INTERNAL_SLACK_CHANNEL_WEBHOOK env var and GIT_COMMIT_SHA are read server-side only.
 */
export const POST = withAuth(async (req, user) => {
  try {
    const { source, message, stack, context } = await req.json();
    const src = `frontend:${source ?? 'unknown'}`;
    const extras: Record<string, string> = {};
    if (stack) extras['stack'] = String(stack).slice(0, 500);
    if (context?.url) extras['url'] = String(context.url);
    if (user?.email) extras['user'] = user.email;
    await notifyInternal(src, String(message), extras);
    return successResponse({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
});
