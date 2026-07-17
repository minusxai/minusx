/**
 * DB-backed LLM call-plan resolution (server-only). Model config is DB-ONLY —
 * there is no env-var tier and no hardcoded provider default.
 *
 * Tier order per use case:
 *   1. `llm.assignments[useCase]` (explicit; the stored `chain` array's first
 *      entry — one model per use case, no fallbacks)
 *   2. the minusx provider entry, if configured (fully managed, keyed)
 *   3. the managed MinusX gateway, unkeyed — the universal default. An
 *      unconfigured workspace routes there and gets a clear auth error
 *      pointing at Settings → Models, instead of silently using some other
 *      vendor's model.
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
import type { LlmPlanStep } from '@/orchestrator/types';
import { E2E_MODE } from '@/lib/constants';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import {
  MINUSX_PROVIDER, CUSTOM_PROVIDER,
  findLlmProvider, findMinusxProvider,
  type ChatModelSelection, type LlmConfig, type LlmModelChoice, type LlmProviderEntry, type LlmUseCase,
} from './llm-config-types';
import { compatDefaultModel, resolveAllowedModels } from './compat-models';

/**
 * Build one executable plan step from a provider entry + model choice.
 * The entry must already have RESOLVED credentials (no refs).
 * Exported for reuse by the connection-test endpoint (`/api/llm/test`).
 */
export function buildPlanStep(entry: LlmProviderEntry, choice: LlmModelChoice, useCase: LlmUseCase, catalog?: ModelCatalog | null): LlmPlanStep {
  const options: Record<string, unknown> = { ...(choice.options ?? {}) };
  if (entry.apiKey) options['apiKey'] = entry.apiKey;

  if (entry.provider === MINUSX_PROVIDER) {
    // Managed gateway: OpenAI-compatible endpoint; the gateway owns model
    // routing + system-prompt policy per use case (X-MX-Use-Case header).
    const model = buildMinusxModel(entry.baseUrl, choice.model || MINUSX_AUTO_MODEL);
    return { model, callOptions: { ...options, ...minusxCallOptions(useCase, entry.headers) } };
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
  // No stored model = "Auto": the per-use-case default from compatibility.json.
  const modelId = choice.model || compatDefaultModel(entry.provider, useCase);
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

/** Resolve one use case's model from an (already secret-resolved) LlmConfig. */
function planFromConfig(llm: LlmConfig | undefined, useCase: LlmUseCase, catalog: ModelCatalog | null): LlmPlanStep | null {
  // Assignments store a `chain` array for schema stability; only the FIRST
  // entry is used (fallbacks were deliberately removed — one model per use case).
  const choice = llm?.assignments?.[useCase]?.chain?.[0];
  if (choice) {
    const entry = findLlmProvider(llm, choice.providerName);
    if (!entry) throw new Error(`LLM assignment for '${useCase}' references unknown provider '${choice.providerName}'`);
    return buildPlanStep(entry, choice, useCase, catalog);
  }
  // No assignment: a configured minusx provider handles every use case.
  const minusx = findMinusxProvider(llm);
  if (minusx) return buildPlanStep(minusx, { providerName: minusx.name }, useCase);
  return null;
}

/** Build a chat-scoped analyst override from server-owned provider config. */
function planFromChatSelection(
  llm: LlmConfig | undefined,
  selection: ChatModelSelection,
  catalog: ModelCatalog | null,
): LlmPlanStep {
  const entry = findLlmProvider(llm, selection.providerName);
  if (!entry) throw new Error(`Chat model provider '${selection.providerName}' is not configured`);

  if (entry.provider !== MINUSX_PROVIDER && !selection.model) {
    throw new Error(`Chat model provider '${selection.providerName}' requires a model id`);
  }

  const allowed = resolveAllowedModels(entry);
  if (selection.model && allowed && !allowed.includes(selection.model)) {
    throw new Error(`Model '${selection.model}' is not allowed for provider '${selection.providerName}'`);
  }

  // A custom endpoint's model capabilities live only in the server-owned
  // assignment. The browser selects that known model id, never its metadata.
  if (entry.provider === CUSTOM_PROVIDER) {
    const configured = llm?.assignments?.analyst?.chain?.[0];
    if (configured?.providerName !== selection.providerName || configured.model !== selection.model) {
      throw new Error(`Model '${selection.model}' is not allowed for custom provider '${selection.providerName}'`);
    }
    return buildPlanStep(entry, configured, 'analyst', catalog);
  }

  return buildPlanStep(entry, selection, 'analyst', catalog);
}

function isTestEnv(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- deterministic tests: unconfigured workspaces stay on faux static models under vitest
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST;
}

/** The universal default: the managed MinusX gateway (sentinel key until configured). */
function minusxDefaultPlan(useCase: LlmUseCase): LlmPlanStep {
  return { model: buildMinusxModel(), callOptions: { apiKey: MINUSX_UNCONFIGURED_KEY, ...minusxCallOptions(useCase) } };
}

/**
 * Resolve the LLM call plan for a use case. LLM providers are WORKSPACE-level
 * infrastructure: always read from the org config, shared by every mode
 * (tutorial chats run on the same providers as org chats — mode isolation is
 * about files/content, not model credentials). Never null in production — an
 * unconfigured workspace gets the MinusX-gateway default. `null` only in test
 * environments (agents keep their faux static models).
 */
export async function resolveLlmPlan(
  useCase: LlmUseCase,
  chatSelection?: ChatModelSelection,
): Promise<LlmPlanStep | null> {
  // E2E builds force every agent onto its faux provider — DB config must not override.
  if (E2E_MODE) return null;
  const raw = await getRawConfig(DEFAULT_MODE);
  const llm = raw.llm as LlmConfig | undefined;
  if (chatSelection && useCase === 'analyst' && !llm) {
    throw new Error(`Chat model provider '${chatSelection.providerName}' is not configured`);
  }
  if (llm) {
    const resolved = await resolveConfigSecrets(llm);
    // Live catalog only matters for model ids newer than the baked registry;
    // fetch is cached in-process and null-safe (baked-only fallback).
    const catalog = await getModelCatalog();
    if (chatSelection && useCase === 'analyst') {
      return planFromChatSelection(resolved, chatSelection, catalog);
    }
    const plan = planFromConfig(resolved, useCase, catalog);
    if (plan) return plan;
  }
  return isTestEnv() ? null : minusxDefaultPlan(useCase);
}

/** Orchestrator hook: per-call plan resolution (workspace-level, mode-independent). */
export function buildLlmPlanResolver(
  chatSelection?: ChatModelSelection,
): (useCase: LlmUseCase) => Promise<LlmPlanStep | null> {
  return (useCase) => resolveLlmPlan(useCase, useCase === 'analyst' ? chatSelection : undefined);
}
