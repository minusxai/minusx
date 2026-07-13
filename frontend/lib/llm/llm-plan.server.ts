/**
 * DB-backed LLM call-plan resolution (server-only).
 *
 * Resolves the ordered model chain (`[primary, ...fallbacks]`) for a use case
 * from the org config's `llm` section. Returns `[]` when the DB has nothing to
 * say — the orchestrator then uses the agent's static (env-config / default)
 * model exactly as before, so existing deployments and tests are unaffected.
 *
 * Tier order per use case:
 *   1. `llm.assignments[useCase].chain` (explicit, may include fallbacks)
 *   2. the minusx provider, if configured (fully managed — no assignment needed)
 *   3. `[]` → static env config / built-in default
 *
 * Provider credentials are `@SECRETS/…` refs at rest; they are resolved here,
 * at call-plan time, and injected as call options — never stored on the model.
 */
import 'server-only';
import { getRawConfig } from '@/lib/data/configs.server';
import { resolveConfigSecrets } from '@/lib/secrets/config-secrets.server';
import { getModel, buildCustomModel, type CustomModelSpec } from '@/orchestrator/llm';
import type { LlmPlanStep } from '@/orchestrator/types';
import { MINUSX_GATEWAY_URL } from '@/lib/config';
import { E2E_MODE } from '@/lib/constants';
import type { Mode } from '@/lib/mode/mode-types';
import {
  MINUSX_PROVIDER, CUSTOM_PROVIDER, MX_USE_CASE_HEADER,
  findLlmProvider, findMinusxProvider,
  type LlmConfig, type LlmModelChoice, type LlmProviderEntry, type LlmUseCase,
} from './llm-config-types';

/**
 * Build one executable plan step from a provider entry + model choice.
 * The entry must already have RESOLVED credentials (no refs).
 * Exported for reuse by the connection-test endpoint (`/api/llm/test`).
 */
export function buildPlanStep(entry: LlmProviderEntry, choice: LlmModelChoice, useCase: LlmUseCase): LlmPlanStep {
  const options: Record<string, unknown> = { ...(choice.options ?? {}) };
  if (entry.apiKey) options['apiKey'] = entry.apiKey;

  if (entry.provider === MINUSX_PROVIDER) {
    // Managed gateway: OpenAI-compatible endpoint; the gateway owns model
    // routing + system-prompt policy per use case (X-MX-Use-Case header).
    const model = buildCustomModel({
      baseUrl: entry.baseUrl || MINUSX_GATEWAY_URL,
      id: choice.model || 'minusx-auto',
      provider: MINUSX_PROVIDER,
      name: 'MinusX',
      reasoning: true,
      input: ['text', 'image'],
    });
    options['headers'] = { ...(entry.headers ?? {}), [MX_USE_CASE_HEADER]: useCase };
    return { model, callOptions: options };
  }

  if (entry.provider === CUSTOM_PROVIDER) {
    if (!entry.baseUrl) throw new Error(`LLM provider '${entry.name}': custom provider requires a baseUrl`);
    if (!choice.model) throw new Error(`LLM provider '${entry.name}': custom provider requires a model id`);
    const model = buildCustomModel({
      baseUrl: entry.baseUrl,
      id: choice.model,
      provider: entry.name,
      ...(entry.headers ? { headers: entry.headers } : {}),
      ...(choice.customModel ?? {}),
    } as CustomModelSpec);
    return { model, callOptions: options };
  }

  // Registry provider (anthropic / openai / google / amazon-bedrock / …).
  if (!choice.model) throw new Error(`LLM provider '${entry.name}': model id is required`);
  const model = getModel(entry.provider, choice.model);
  if (entry.provider === 'amazon-bedrock') {
    if (entry.awsRegion) options['region'] = entry.awsRegion;
    // Bedrock auth is a bearer-token API key, not a plain apiKey option.
    if (entry.apiKey) {
      delete options['apiKey'];
      options['bearerToken'] = entry.apiKey;
    }
  }
  return { model, callOptions: options };
}

/** Resolve the chain for one use case from an (already secret-resolved) LlmConfig. */
function planFromConfig(llm: LlmConfig | undefined, useCase: LlmUseCase): LlmPlanStep[] {
  const chain = llm?.assignments?.[useCase]?.chain;
  if (chain && chain.length > 0) {
    return chain.map(choice => {
      const entry = findLlmProvider(llm, choice.providerName);
      if (!entry) throw new Error(`LLM assignment for '${useCase}' references unknown provider '${choice.providerName}'`);
      return buildPlanStep(entry, choice, useCase);
    });
  }
  // No assignment: a configured minusx provider handles every use case.
  const minusx = findMinusxProvider(llm);
  if (minusx) return [buildPlanStep(minusx, { providerName: minusx.name }, useCase)];
  return [];
}

/**
 * Resolve the LLM call plan for a use case in a mode. `[]` = nothing configured
 * in the DB — caller falls back to the agent's static model.
 */
export async function resolveLlmPlan(mode: Mode, useCase: LlmUseCase): Promise<LlmPlanStep[]> {
  // E2E builds force every agent onto its faux provider — DB config must not override.
  if (E2E_MODE) return [];
  const raw = await getRawConfig(mode);
  const llm = raw.llm as LlmConfig | undefined;
  if (!llm) return [];
  const resolved = await resolveConfigSecrets(llm);
  return planFromConfig(resolved, useCase);
}

/** Orchestrator hook: per-call plan resolution bound to a mode. */
export function buildLlmPlanResolver(mode: Mode): (useCase: LlmUseCase) => Promise<LlmPlanStep[]> {
  return (useCase) => resolveLlmPlan(mode, useCase);
}
