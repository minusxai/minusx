import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { ApiErrors, successResponse, handleApiError } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { executeRegisteredTool } from '@/lib/chat/tool-inspector.server';

/**
 * POST /api/tools/execute
 * Admin-only endpoint to re-execute a tool call with (possibly modified) args.
 * Used by the Tool Inspector modal. Backed by the real `REGISTRABLES` tool
 * registry (see `lib/chat/tool-inspector.server.ts`) — the same tools that
 * run in live chat, not a separate shadow implementation.
 *
 * Body: { toolName: string; args: Record<string, any> }
 * Response: { result: string | object } | { error: string }
 */
export const POST = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    const body = await request.json();
    const { toolName, args } = body as { toolName: string; args: Record<string, any> };

    if (!toolName || typeof toolName !== 'string') {
      return ApiErrors.badRequest('toolName is required');
    }

    const outcome = await executeRegisteredTool(toolName, args ?? {}, user);
    if (!outcome.executable) {
      return successResponse({ error: outcome.error });
    }

    return successResponse({ result: outcome.result });
  } catch (error) {
    return handleApiError(error);
  }
});
