import { NextRequest } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';

/**
 * POST /api/capture-error
 * Receives frontend error reports and publishes them as ERROR app events.
 */
export async function POST(req: NextRequest) {
  try {
    const { source, message, stack, context } = await req.json();
    const src = `frontend:${source ?? 'unknown'}`;

    const user = await getEffectiveUser();
    if (user) {
      appEventRegistry.publish(AppEvents.ERROR, {
        mode: user.mode ?? 'org',
        source: src,
        message: String(message),
        context: {
          ...(stack ? { stack: String(stack).slice(0, 500) } : {}),
          ...(context?.url ? { url: String(context.url) } : {}),
          user: user.email,
        },
      });
    }

    return successResponse({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
