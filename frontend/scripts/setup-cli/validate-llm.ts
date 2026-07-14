// setup-cli: validate an LLM provider entry + model choice with a real
// one-token call — the same probe behind POST /api/llm/test.
//
//   echo '{"provider":{"name":"openai","provider":"openai","apiKey":"sk-…"},"model":"gpt-5.4"}' \
//     | docker run --rm -i <image> node setup-cli/validate-llm.js
//
// stdin: { provider: LlmProviderEntry, model?: string, options?: object }
// stdout: LlmTestResult JSON ({ ok, error?, latencyMs?, model? })
import { testLlmEntry, type LlmTestResult } from '@/lib/llm/llm-test.server';
import type { LlmProviderEntry } from '@/lib/llm/llm-config-types';
import { readStdinJson, emit, isMain, type CliOutcome } from './io';

export async function runValidateLlm(input: unknown): Promise<CliOutcome<LlmTestResult>> {
  const body = (input ?? {}) as { provider?: LlmProviderEntry; model?: string; options?: Record<string, unknown> };
  const entry = body.provider;
  if (!entry || typeof entry.name !== 'string' || entry.name === '' || typeof entry.provider !== 'string' || entry.provider === '') {
    return { result: { ok: false, error: 'input requires a provider with name and provider fields' }, exitCode: 2 };
  }
  const result = await testLlmEntry(entry, { model: body.model, options: body.options });
  return { result, exitCode: result.ok ? 0 : 1 };
}

if (isMain(import.meta.url)) {
  void emit(readStdinJson().then(runValidateLlm));
}
