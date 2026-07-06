import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors } from '@/lib/http/api-responses';
import { REGISTRABLES } from '@/lib/chat/orchestration-core.server';

interface RegistrableSchema {
  name: string;
  description?: string;
  parameters?: unknown;
}

// Return OpenAI-style function schemas for the chat tools/agents (dev tool tester,
// DevToolsPanel). Built from the TS registrables.
export const GET = withAuth(async (_request, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }
  const schemas = REGISTRABLES.map((cls) => (cls as { schema?: RegistrableSchema }).schema)
    .filter((s): s is RegistrableSchema => !!s?.name)
    .map((s) => ({
      type: 'function' as const,
      function: { name: s.name, description: s.description ?? '', parameters: s.parameters ?? {} },
    }));
  return NextResponse.json(schemas);
});
