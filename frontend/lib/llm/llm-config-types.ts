/**
 * In-app LLM provider configuration — the `llm` section of the org config
 * document (`/configs/config`). This is the ONLY model configuration surface
 * (no env-var tier): DB config > managed MinusX gateway default, resolved per
 * call in `lib/llm/llm-plan.server.ts`.
 *
 * Pure types + pure helpers only — imported by both server resolution and the
 * settings UI. `apiKey` values are `@SECRETS/…` refs at rest (see
 * `lib/secrets/config-secret-specs.ts`); the client never sees a raw key.
 */

/** Which model assignment an agent consumes. */
export type LlmUseCase = 'analyst' | 'micro';
export const LLM_USE_CASES: readonly LlmUseCase[] = ['analyst', 'micro'];

/**
 * Provider slug for the managed MinusX provider: routed through the MinusX
 * gateway (OpenAI-compatible), which owns model choice + routing per use case.
 * Selecting it requires no model/assignment/fallback configuration.
 */
export const MINUSX_PROVIDER = 'minusx';
/** Provider slug for a self-managed OpenAI-compatible endpoint (Ollama, vLLM, …). */
export const CUSTOM_PROVIDER = 'custom';

/** Header carrying the use case to the MinusX gateway for routing. */
export const MX_USE_CASE_HEADER = 'X-MX-Use-Case';

/**
 * A credentialed LLM endpoint. `provider` is either a pi-ai registry slug
 * ('anthropic', 'openai', 'google', 'amazon-bedrock', …), `MINUSX_PROVIDER`,
 * or `CUSTOM_PROVIDER`. `name` uniquely identifies the entry (it also keys the
 * secret refs, so renaming re-extracts on next key entry).
 */
export interface LlmProviderEntry {
  name: string;
  provider: string;
  /** API key / bearer token. For amazon-bedrock this is a Bedrock API key
   *  (bearer token auth); SigV4 env-credential auth also works with no key. */
  apiKey?: string;
  /** amazon-bedrock only: AWS region of the Bedrock endpoint. */
  awsRegion?: string;
  /** custom/minusx only: OpenAI-compatible base URL (minusx has a built-in default). */
  baseUrl?: string;
  /** custom only: extra HTTP headers merged into requests. */
  headers?: Record<string, string>;
  /**
   * Registry providers only: model ids admins allow for assignments. The
   * assignment model picker shows ONLY these (plus a currently-assigned model,
   * so an existing pick never disappears). Absent/empty = all registry models;
   * 'auto' = the provider's recommended set from compatibility.json, resolved
   * live (see `lib/llm/compat-models.ts`). A UI-level allowlist — resolution
   * honors whatever the assignment stores.
   */
  allowedModels?: string[] | 'auto';
}

/** One model pick in an assignment chain. */
export interface LlmModelChoice {
  /** References `LlmProviderEntry.name`. */
  providerName: string;
  /** Model id — a pi-ai registry id for registry providers, the endpoint's
   *  model id for custom, ignored for minusx (the gateway routes). */
  model?: string;
  /** Call-time stream options (e.g. `reasoning`), spread into the LLM call. */
  options?: Record<string, unknown>;
  /** custom only: overrides for the custom endpoint model spec
   *  (contextWindow, maxTokens, reasoning, input, compat, …). */
  customModel?: Record<string, unknown>;
}

/**
 * A user-selected model override for an individual chat. Deliberately smaller
 * than `LlmModelChoice`: call options and custom endpoint metadata remain
 * server-owned configuration and can never be injected by the browser.
 */
export interface ChatModelSelection {
  /** References `LlmProviderEntry.name`. */
  providerName: string;
  /** Concrete model id. Omitted only for a managed MinusX provider. */
  model?: string;
}

/** Picker-safe model metadata returned to authenticated chat clients. */
export interface ChatModelOption extends ChatModelSelection {
  providerLabel: string;
  modelLabel: string;
}

/** Model-picker payload. Omitting an override remains the source of truth for
 * using the live Settings → Models assignment represented by `defaultModel`. */
export interface ChatModelCatalog {
  defaultModel: ChatModelOption;
  models: ChatModelOption[];
}

/**
 * One use case's model pick. The `chain` array is a stable storage shape;
 * only the FIRST entry is used (fallbacks were deliberately removed — one
 * model per use case; extra entries in hand-edited configs are ignored).
 */
export interface LlmUseCaseAssignment {
  chain: LlmModelChoice[];
}

/** The `llm` section of the org config. */
export interface LlmConfig {
  providers?: LlmProviderEntry[];
  /**
   * Per-use-case chains. A use case with no assignment falls back to: the
   * minusx provider if one is configured (fully managed — no assignment
   * needed), else env config, else the built-in default.
   */
  assignments?: Partial<Record<LlmUseCase, LlmUseCaseAssignment>>;
}

/** Find a provider entry by name. */
export function findLlmProvider(config: LlmConfig | undefined, name: string): LlmProviderEntry | undefined {
  return config?.providers?.find(p => p.name === name);
}

/** The configured minusx provider entry, if any. */
export function findMinusxProvider(config: LlmConfig | undefined): LlmProviderEntry | undefined {
  return config?.providers?.find(p => p.provider === MINUSX_PROVIDER);
}
