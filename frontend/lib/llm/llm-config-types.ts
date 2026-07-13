/**
 * In-app LLM provider configuration — the `llm` section of the org config
 * document (`/configs/config`). Replaces env-only model config
 * (`ANALYST_AGENT_MODEL_CONFIG` / `MICRO_AGENT_MODEL_CONFIG`), which remains as
 * the fallback tier: DB config > env config > built-in default
 * (resolved in `lib/llm/llm-plan.server.ts`).
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

/** Ordered chain for one use case: `[primary, ...fallbacks]`. */
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
