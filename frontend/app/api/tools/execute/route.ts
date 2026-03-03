import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { ApiErrors, successResponse, handleApiError } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { canExecuteTool, toolRegistry } from '@/app/api/chat/orchestrator';
import type { ToolCall } from '@/lib/types';

// Import tool handlers to register them (same pattern as chat/route.ts)
import '@/app/api/chat/tool-handlers.server';

/**
 * POST /api/tools/execute
 * Admin-only endpoint to re-execute a tool call with (possibly modified) args.
 * Used by the Tool Inspector modal.
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

    // Build a minimal ToolCall to check registry membership
    const syntheticToolCall: ToolCall = {
      id: `inspect-${Date.now()}`,
      type: 'function',
      function: {
        name: toolName,
        arguments: args ?? {},
      },
    };

    if (!canExecuteTool(syntheticToolCall)) {
      return successResponse({ error: 'Tool not re-executable from the browser' });
    }

    const handler = toolRegistry[toolName];
    const result = await handler(args ?? {}, user);

    return successResponse({ result });
  } catch (error) {
    return handleApiError(error);
  }
});
