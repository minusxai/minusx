import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getRawConfig } from '@/lib/data/configs.server';
import { resolveConfigSecrets } from '@/lib/secrets/config-secrets.server';
import { isRedactedSecret } from '@/lib/secrets/config-secret-specs';
import { testLlmEntry } from '@/lib/llm/llm-test.server';
import { findLlmProvider, type LlmConfig, type LlmProviderEntry } from '@/lib/llm/llm-config-types';

interface TestLlmRequest {
  provider?: LlmProviderEntry;
  model?: string;
  options?: Record<string, unknown>;
}

/**
 * POST /api/llm/test — one-shot connectivity test for an LLM provider entry
 * (admin-only). The key may be raw (newly typed), a `@SECRETS/…` ref, or the
 * redacted placeholder (= "test the saved key for this provider name"). The
 * key is used server-side only and never echoed back. The probe itself is
 * shared with the setup-cli (`lib/llm/llm-test.server.ts`).
 */
export const POST = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can test LLM providers');
  }

  let body: TestLlmRequest;
  try {
    body = await request.json() as TestLlmRequest;
  } catch {
    return ApiErrors.validationError('Invalid request body');
  }
  const entry = body.provider;
  if (!entry || typeof entry.name !== 'string' || entry.name === '' || typeof entry.provider !== 'string' || entry.provider === '') {
    return ApiErrors.validationError('provider requires name and provider fields');
  }

  try {
    // A redacted placeholder means "the saved key": swap in the stored ref for
    // this provider name, then resolve refs to raw values (server-side only).
    let candidate: LlmProviderEntry = { ...entry };
    if (isRedactedSecret(candidate.apiKey)) {
      // LLM config is workspace-level (org config) regardless of the caller's mode.
      const stored = findLlmProvider((await getRawConfig()).llm as LlmConfig | undefined, candidate.name);
      if (!stored?.apiKey) {
        return successResponse({ ok: false, error: `No saved API key for provider '${candidate.name}'` });
      }
      candidate = { ...candidate, apiKey: stored.apiKey };
    }
    candidate = await resolveConfigSecrets(candidate);

    return successResponse(await testLlmEntry(candidate, { model: body.model, options: body.options }));
  } catch (error) {
    return handleApiError(error);
  }
});
