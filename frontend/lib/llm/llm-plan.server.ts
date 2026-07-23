/**
 * DB-backed LLM call-plan resolution (server-only). Model config is DB-ONLY —
 * there is no env-var tier and no hardcoded provider default.
 *
 * Resolution per call: selector (agent + optional code-owned grade) → the
 * agent's grade policy (config over built-in defaults) → a grade → a model:
 *   1. `llm.grades[grade]` (explicit mapping: one provider+model per grade)
 *   2. the minusx provider entry, if configured (fully managed, keyed — the
 *      gateway routes the grade)
 *   3. with an `llm` section but neither: a hard error naming the unmapped
 *      grade (no silent nearest-grade fallback)
 * A workspace with NO `llm` section routes to the managed MinusX gateway,
 * unkeyed — the universal default. An unconfigured workspace gets a clear
 * auth error pointing at Settings → Models, instead of silently using some
 * other vendor's model.
 *
 * A per-chat grade override (the user's picker) is validated against the
 * agent's allowed grades; a selector grade (code-owned, e.g. a micro-task
 * needing a stronger class) is not.
 *
 * Test environments return `null` (agents use their faux static models) so the
 * suite stays deterministic and network-free.
 *
 * Provider credentials are `@SECRETS/…` refs at rest; they are resolved here,
 * at call-plan time, and injected as call options — never stored on the model.
 */
import 'server-only';
import { getRawConfig } from '@/lib/data/configs.server';
import { resolveConfigSecrets } from '@/lib/secrets/config-secrets.server';
import { getModel, buildCustomModel, buildRegistryModel, type CustomModelSpec } from '@/orchestrator/llm';
import { getModelCatalog, type ModelCatalog } from './model-catalog.server';
import { buildMinusxModel, minusxCallOptions, MINUSX_AUTO_MODEL, MINUSX_UNCONFIGURED_KEY } from './minusx-default';
import type { LlmPlanStep, LlmPlanSelector } from '@/orchestrator/types';
import { E2E_MODE } from '@/lib/constants';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import {
  LLM_AGENT_KEYS, LLM_GRADES, MINUSX_PROVIDER, CUSTOM_PROVIDER,
  findLlmProvider, findMinusxProvider, resolveAgentPolicy,
  type LlmAgentKey, type LlmConfig, type LlmGrade, type LlmModelChoice, type LlmProviderEntry,
} from './llm-config-types';
import { compatDefaultModel } from './compat-models';

/**
 * Build one executable plan step from a provider entry + model choice.
 * The entry must already have RESOLVED credentials (no refs).
 * Exported for reuse by the connection-test endpoint (`/api/llm/test`).
 */
export function buildPlanStep(entry: LlmProviderEntry, choice: LlmModelChoice, grade: LlmGrade, catalog?: ModelCatalog | null): LlmPlanStep {
  const options: Record<string, unknown> = { ...(choice.options ?? {}) };
  if (entry.apiKey) options['apiKey'] = entry.apiKey;

  if (entry.provider === MINUSX_PROVIDER) {
    // Managed gateway: OpenAI-compatible endpoint; the gateway owns model
    // routing + system-prompt policy per grade (X-MX-Use-Case header).
    const model = buildMinusxModel(entry.baseUrl, choice.model || MINUSX_AUTO_MODEL);
    return { model, callOptions: { ...options, ...minusxCallOptions(grade, entry.headers) } };
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
  // No stored model = "Auto": the per-grade default from compatibility.json.
  const modelId = choice.model || compatDefaultModel(entry.provider, grade);
  if (!modelId) throw new Error(`LLM provider '${entry.name}': model id is required (no compatibility default for '${entry.provider}')`);
  let model;
  try {
    model = getModel(entry.provider, modelId);
  } catch (registryError) {
    // Model id newer than the baked pi-ai registry: resolve via the live
    // models.dev catalog (same wire API as the provider's baked models).
    const live = catalog?.get(entry.provider)?.get(modelId);
    if (!live) throw registryError;
    model = buildRegistryModel(entry.provider, modelId, live);
  }
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

/** Resolve one grade's model from an (already secret-resolved) LlmConfig. */
function planFromConfig(llm: LlmConfig, agent: LlmAgentKey, grade: LlmGrade, catalog: ModelCatalog | null): LlmPlanStep {
  const choice = llm.grades?.[grade];
  if (choice) {
    const entry = findLlmProvider(llm, choice.providerName);
    if (!entry) throw new Error(`Grade '${grade}' references unknown provider '${choice.providerName}'`);
    return buildPlanStep(entry, choice, grade, catalog);
  }
  // No mapping: a configured minusx provider handles every grade (the gateway
  // routes the grade itself).
  const minusx = findMinusxProvider(llm);
  if (minusx) return buildPlanStep(minusx, { providerName: minusx.name }, grade);
  throw new Error(`No model is mapped to grade '${grade}' (agent '${agent}'). Map it in Settings → Models.`);
}

function isTestEnv(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- deterministic tests: unconfigured workspaces stay on faux static models under vitest
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST;
}

/** The universal default: the managed MinusX gateway (sentinel key until configured). */
function minusxDefaultPlan(grade: LlmGrade): LlmPlanStep {
  return { model: buildMinusxModel(), callOptions: { apiKey: MINUSX_UNCONFIGURED_KEY, ...minusxCallOptions(grade) } };
}

/** Narrow an engine-side selector string to a known agent key (benchmark/eval
 *  agents and future strings ride the analyst policy). */
function toAgentKey(agent: string): LlmAgentKey {
  return (LLM_AGENT_KEYS as readonly string[]).includes(agent) ? agent as LlmAgentKey : 'analyst';
}

/**
 * Resolve the LLM call plan for a selector. LLM providers are WORKSPACE-level
 * infrastructure: always read from the org config, shared by every mode
 * (tutorial chats run on the same providers as org chats — mode isolation is
 * about files/content, not model credentials). Never null in production — an
 * unconfigured workspace gets the MinusX-gateway default. `null` only in test
 * environments (agents keep their faux static models).
 */
export async function resolveLlmPlan(
  selector: LlmPlanSelector,
  gradeOverride?: LlmGrade,
): Promise<LlmPlanStep | null> {
  // E2E builds force every agent onto its faux provider — DB config must not override.
  if (E2E_MODE) return null;
  const agent = toAgentKey(selector.agent);
  const raw = await getRawConfig(DEFAULT_MODE);
  const llm = raw.llm as LlmConfig | undefined;
  const policy = resolveAgentPolicy(llm, agent);

  // The user's per-chat pick is bounded by the agent policy; a selector grade
  // (code-owned, e.g. rubric_llm → core) is not.
  if (gradeOverride && !policy.allowedGrades.includes(gradeOverride)) {
    throw new Error(`Grade '${gradeOverride}' is not allowed for agent '${agent}'`);
  }
  const selectorGrade = selector.grade && (LLM_GRADES as readonly string[]).includes(selector.grade)
    ? selector.grade as LlmGrade
    : undefined;
  const grade = gradeOverride ?? selectorGrade ?? policy.defaultGrade;

  if (llm) {
    const resolved = await resolveConfigSecrets(llm);
    // Live catalog only matters for model ids newer than the baked registry;
    // fetch is cached in-process and null-safe (baked-only fallback).
    const catalog = await getModelCatalog();
    return planFromConfig(resolved, agent, grade, catalog);
  }
  return isTestEnv() ? null : minusxDefaultPlan(grade);
}

/** Orchestrator hook: per-call plan resolution (workspace-level, mode-independent). */
export function buildLlmPlanResolver(
  gradeOverride?: LlmGrade,
): (selector: LlmPlanSelector) => Promise<LlmPlanStep | null> {
  return (selector) => resolveLlmPlan(selector, gradeOverride);
}
