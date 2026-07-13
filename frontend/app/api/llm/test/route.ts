import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getRawConfig } from '@/lib/data/configs.server';
import { resolveConfigSecrets } from '@/lib/secrets/config-secrets.server';
import { isRedactedSecret } from '@/lib/secrets/config-secret-specs';
import { buildPlanStep } from '@/lib/llm/llm-plan.server';
import { getModelCatalog } from '@/lib/llm/model-catalog.server';
import { findLlmProvider, type LlmConfig, type LlmProviderEntry } from '@/lib/llm/llm-config-types';
import { streamSimple, type Model, type Api } from '@/orchestrator/llm';

interface TestLlmRequest {
  provider?: LlmProviderEntry;
  model?: string;
  options?: Record<string, unknown>;
}

const TEST_TIMEOUT_MS = 20_000;

/**
 * POST /api/llm/test — one-shot connectivity test for an LLM provider entry
 * (admin-only). The key may be raw (newly typed), a `@SECRETS/…` ref, or the
 * redacted placeholder (= "test the saved key for this provider name"). The
 * key is used server-side only and never echoed back.
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
      const stored = findLlmProvider((await getRawConfig(user.mode)).llm as LlmConfig | undefined, candidate.name);
      if (!stored?.apiKey) {
        return successResponse({ ok: false, error: `No saved API key for provider '${candidate.name}'` });
      }
      candidate = { ...candidate, apiKey: stored.apiKey };
    }
    candidate = await resolveConfigSecrets(candidate);

    // Build the executable step; config errors (unknown model, missing
    // baseUrl) surface as ok:false, not a 500.
    let model: Model<Api>;
    let callOptions: Record<string, unknown> | undefined;
    try {
      const catalog = await getModelCatalog();
      const step = buildPlanStep(candidate, { providerName: candidate.name, model: body.model, options: body.options }, 'analyst', catalog);
      model = step.model;
      callOptions = step.callOptions;
    } catch (err) {
      return successResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }

    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      const stream = streamSimple(model, {
        messages: [{ role: 'user', content: 'Connection test: reply with the single word "ok".', timestamp: Date.now() }],
      }, {
        ...(callOptions ?? {}),
        signal: controller.signal,
        // Fail fast — a connectivity test should not ride the retry ladder.
        maxRetryDelayMs: 1_000,
      });
      let error: string | null = null;
      let done = false;
      for await (const ev of stream) {
        if (ev.type === 'done') done = true;
        else if (ev.type === 'error') error = ev.error.errorMessage ?? `LLM call failed (${ev.error.stopReason})`;
      }
      if (!done || error) {
        return successResponse({ ok: false, error: error ?? 'LLM stream ended without a response' });
      }
      return successResponse({ ok: true, latencyMs: Date.now() - t0, model: model.id });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return handleApiError(error);
  }
});
