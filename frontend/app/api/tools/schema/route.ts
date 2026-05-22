import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors } from '@/lib/api/api-responses';
import { V2_REGISTRABLES } from '@/lib/chat-orchestration-v2.server';

interface RegistrableSchema {
  name: string;
  description?: string;
  parameters?: unknown;
}

// Return OpenAI-style function schemas for the v2 tools/agents (dev tool tester,
// DevToolsPanel). Built from the TS registrables — no Python backend.
export const GET = withAuth(async (_request, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }
  const schemas = V2_REGISTRABLES.map((cls) => (cls as { schema?: RegistrableSchema }).schema)
    .filter((s): s is RegistrableSchema => !!s?.name)
    .map((s) => ({
      type: 'function' as const,
      function: { name: s.name, description: s.description ?? '', parameters: s.parameters ?? {} },
    }));
  return NextResponse.json(schemas);
});
