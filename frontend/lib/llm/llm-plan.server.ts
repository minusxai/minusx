/**
 * DB-backed LLM call-plan resolution (server-only). Model config is DB-ONLY —
 * there is no env-var tier and no hardcoded provider default.
 *
 * Resolution per call: selector (agent + optional code-owned grade) → the
 * agent's grade policy (config over built-in defaults) → a grade → a model:
 *   1. the minusx provider entry, if configured (fully managed, keyed — the
 *      gateway routes the grade, and owns EVERY grade: picking it is picking
 *      managed model selection, so a stored mapping cannot escape it)
 *   2. `llm.grades[grade]` (explicit mapping: one provider+model per grade)
 *   3. the workspace's SOLE bring-your-own-key provider, run as "Auto" (the
 *      compatibility.json default for the grade) — connecting one provider
 *      powers every grade with no further setup
 *   4. with an `llm` section but none of those: a hard error naming the
 *      unmapped grade (no silent nearest-grade fallback). Reached only when
 *      the pick would be a guess — 2+ BYOK providers, or a provider with no
 *      curation for the grade (custom endpoints, niche registry slugs).
 * A workspace with no configured endpoint — no `llm` section, or one holding
 * neither providers nor grades — routes to the managed MinusX gateway,
 * unkeyed: the universal default. An unconfigured workspace gets a clear
 * auth error pointing at Settings → Models, instead of silently using some
 * other vendor's model.
 *
 * A per-chat grade override (the user's picker) is validated against the
 * agent's allowed grades; a selector grade (code-owned, e.g. a micro-task
 * needing a stronger class) is not.
 *
 * Test environments return `null` for an UNCONFIGURED workspace (agents use
 * their faux static models) so the suite stays deterministic and network-free;
 * a test that writes an `llm` section still resolves a real plan. E2E builds
 * return `null` unconditionally.
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
  findLlmProvider, findMinusxProvider, hasLlmEndpoints, resolveAgentPolicy, supportsNativeWebSearch,
  type LlmAgentKey, type LlmConfig, type LlmGrade, type LlmModelChoice, type LlmProviderEntry,
} from './llm-config-types';
import { autoGradeProvider, compatDefaultModel } from './compat-models';

/**
 * Build one executable plan step from a provider entry + model choice.
 * The entry must already have RESOLVED credentials (no refs).
 * Exported for reuse by the connection-test endpoint (`/api/llm/test`).
 */
export function buildPlanStep(entry: LlmProviderEntry, choice: LlmModelChoice, grade: LlmGrade, agent: LlmAgentKey, catalog?: ModelCatalog | null): LlmPlanStep {
  const options: Record<string, unknown> = { ...(choice.options ?? {}) };
  if (entry.apiKey) options['apiKey'] = entry.apiKey;
  // Native web search is injected by API shape, not by provider (see
  // NATIVE_WEB_SEARCH_PROVIDERS). Sending it to a provider that speaks the
  // shape without implementing the tool 400s the entire request, so drop it
  // here — this is the only layer that knows which provider a grade resolved to.
  if (options['webSearch'] && !supportsNativeWebSearch(entry.provider)) delete options['webSearch'];

  if (entry.provider === MINUSX_PROVIDER) {
    // Managed gateway: OpenAI-compatible endpoint; the gateway owns model
    // routing + system-prompt policy per grade (X-MX-Use-Case header). The
    // model is ALWAYS the `minusx-auto` sentinel — `choice.model` is ignored
    // (the gateway routes by grade). Honoring a stored model here would let a
    // stale id linger from a grade that was remapped away from another provider
    // in Settings → Models, and that non-sentinel id 400s the gateway.
    const model = buildMinusxModel(entry.baseUrl, MINUSX_AUTO_MODEL);
    return { model, callOptions: { ...options, ...minusxCallOptions(grade, agent, entry.headers) } };
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
  // MinusX first, ahead of any stored grade mapping. Choosing the managed
  // gateway is choosing to have model selection managed, and a per-grade
  // mapping alongside it produces a half-managed workspace: some grades routed
  // by MinusX, others pinned to a vendor model it knows nothing about, and no
  // single place that answers "what runs this?". Settings hides the per-grade
  // pickers while MinusX is configured, but a mapping stored before it was
  // added would otherwise still be honoured here.
  const minusx = findMinusxProvider(llm);
  if (minusx) return buildPlanStep(minusx, { providerName: minusx.name }, grade, agent);

  const choice = llm.grades?.[grade];
  if (choice) {
    const entry = findLlmProvider(llm, choice.providerName);
    if (!entry) throw new Error(`Grade '${grade}' references unknown provider '${choice.providerName}'`);
    return buildPlanStep(entry, choice, grade, agent, catalog);
  }
  // Still no mapping, but the workspace has exactly ONE bring-your-own-key
  // provider with curation for this grade: run it as "Auto". Connecting a
  // single provider is the overwhelmingly common setup, and requiring three
  // separate grade mappings on top of it means a saved-and-tested provider
  // still fails every call. Grade-agnostic, so lite/micro is covered too.
  const auto = autoGradeProvider(llm, grade);
  if (auto) return buildPlanStep(auto, { providerName: auto.name }, grade, agent, catalog);
  throw new Error(`No model is mapped to grade '${grade}' (agent '${agent}'). Map it in Settings → Models.`);
}

function isTestEnv(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- deterministic tests: unconfigured workspaces stay on faux static models under vitest
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST;
}

/** The universal default: the managed MinusX gateway (sentinel key until configured). */
function minusxDefaultPlan(grade: LlmGrade, agent: LlmAgentKey): LlmPlanStep {
  return { model: buildMinusxModel(), callOptions: { apiKey: MINUSX_UNCONFIGURED_KEY, ...minusxCallOptions(grade, agent) } };
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

  // An `llm` section with no providers and no grade mappings is not a
  // configuration — it's what Settings → Models leaves behind once the last
  // provider is deleted, and the page cannot remove the section itself. Treat
  // it as unconfigured rather than a dead end no admin can undo from the UI.
  if (hasLlmEndpoints(llm)) {
    const resolved = await resolveConfigSecrets(llm);
    // Live catalog only matters for model ids newer than the baked registry;
    // fetch is cached in-process and null-safe (baked-only fallback).
    const catalog = await getModelCatalog();
    // Stamp the resolved grade on the step so the orchestrator can record it per call.
    return { ...planFromConfig(resolved, agent, grade, catalog), grade };
  }
  return isTestEnv() ? null : { ...minusxDefaultPlan(grade, agent), grade };
}

/** Orchestrator hook: per-call plan resolution (workspace-level, mode-independent). */
export function buildLlmPlanResolver(
  gradeOverride?: LlmGrade,
): (selector: LlmPlanSelector) => Promise<LlmPlanStep | null> {
  return (selector) => resolveLlmPlan(selector, gradeOverride);
}
