/**
 * One-shot LLM connectivity probe — shared by POST /api/llm/test (Settings /
 * setup-wizard Test button) and the setup-cli (`scripts/setup-cli/validate-llm.ts`,
 * run via `docker run` by setup.sh). Callers own auth and secret-ref
 * resolution; this module only builds the step and makes the call.
 */
import 'server-only';
import { buildPlanStep } from '@/lib/llm/llm-plan.server';
import { getModelCatalog } from '@/lib/llm/model-catalog.server';
import type { LlmProviderEntry } from '@/lib/llm/llm-config-types';
import { streamSimple, type Model, type Api } from '@/orchestrator/llm';

export interface LlmTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  /** Resolved model id the probe actually called. */
  model?: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** Make a single minimal call against an already-built model handle. */
export async function runLlmProbe(
  model: Model<Api>,
  callOptions: Record<string, unknown> | undefined,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<LlmTestResult> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      return { ok: false, error: error ?? 'LLM stream ended without a response' };
    }
    return { ok: true, latencyMs: Date.now() - t0, model: model.id };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a provider entry + model choice into a callable step and probe it.
 * Config errors (unknown model, missing baseUrl, …) surface as `ok: false`,
 * never a throw. The entry must carry RAW credentials — resolve `@SECRETS/…`
 * refs before calling.
 */
export async function testLlmEntry(
  entry: LlmProviderEntry,
  choice: { model?: string; options?: Record<string, unknown> } = {},
  opts: { timeoutMs?: number } = {},
): Promise<LlmTestResult> {
  let model: Model<Api>;
  let callOptions: Record<string, unknown> | undefined;
  try {
    const catalog = await getModelCatalog();
    // The probe rides the core grade (compat core default for model-less
    // registry entries; `core` in the minusx routing header).
    const step = buildPlanStep(entry, { providerName: entry.name, model: choice.model, options: choice.options }, 'core', catalog);
    model = step.model;
    callOptions = step.callOptions;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return runLlmProbe(model, callOptions, opts.timeoutMs);
}
