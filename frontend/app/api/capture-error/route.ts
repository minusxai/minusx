import { NextRequest } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { notifyInternal } from '@/lib/messaging/internal-notifier';

/**
 * POST /api/capture-error
 * Receives frontend error reports.
 * - Authenticated: publishes ERROR app event (bug reporting channel + customer error_delivery channels)
 * - Unauthenticated: calls notifyInternal directly (bug reporting channel only)
 */
export async function POST(req: NextRequest) {
  try {
    const { source, message, stack, context } = await req.json();
    const src = `frontend:${source ?? 'unknown'}`;
    const ctx: Record<string, unknown> = {
      ...(stack ? { stack: String(stack).slice(0, 500) } : {}),
      ...(context?.url ? { url: String(context.url) } : {}),
    };

    const user = await getEffectiveUser();
    if (user?.companyId) {
      ctx['user'] = user.email;
      appEventRegistry.publish(AppEvents.ERROR, {
        companyId: user.companyId,
        mode: user.mode ?? 'org',
        source: src,
        message: String(message),
        context: ctx,
      });
    } else {
      // Not authenticated — report internally only (no companyId for event registry)
      await notifyInternal(src, String(message), ctx as Record<string, string>);
    }

    return successResponse({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
