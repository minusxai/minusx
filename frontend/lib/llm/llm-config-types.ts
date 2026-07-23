/**
 * In-app LLM provider configuration — the `llm` section of the org config
 * document (`/configs/config`). This is the ONLY model configuration surface
 * (no env-var tier): DB config > managed MinusX gateway default, resolved per
 * call in `lib/llm/llm-plan.server.ts`.
 *
 * The model abstraction is GRADES: admins map each grade (lite/core/advanced) to
 * one (provider, model, options); agents carry a grade policy (allowed grades
 * + default) resolved from config over built-in defaults; end users pick a
 * grade, never a raw model.
 *
 * Pure types + pure helpers only — imported by both server resolution and the
 * settings UI. `apiKey` values are `@SECRETS/…` refs at rest (see
 * `lib/secrets/config-secret-specs.ts`); the client never sees a raw key.
 */

/** Model capability grade — the only user-facing model abstraction. */
export type LlmGrade = 'lite' | 'core' | 'advanced';
export const LLM_GRADES: readonly LlmGrade[] = ['lite', 'core', 'advanced'];

/**
 * Provider slug for the managed MinusX provider: routed through the MinusX
 * gateway (OpenAI-compatible), which owns model choice + routing per grade.
 * Selecting it requires no grade mapping configuration.
 */
export const MINUSX_PROVIDER = 'minusx';
/** Provider slug for a self-managed OpenAI-compatible endpoint (Ollama, vLLM, …). */
export const CUSTOM_PROVIDER = 'custom';

/** Header carrying the requested grade to the MinusX gateway for routing. */
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

/** One grade's model pick. */
export interface LlmModelChoice {
  /** References `LlmProviderEntry.name`. */
  providerName: string;
  /** Model id — a pi-ai registry id for registry providers, the endpoint's
   *  model id for custom, ignored for minusx (the gateway routes). Absent for
   *  a registry provider = "Auto": the grade default from compatibility.json. */
  model?: string;
  /** Call-time stream options (e.g. `reasoning`), spread into the LLM call. */
  options?: Record<string, unknown>;
  /** custom only: overrides for the custom endpoint model spec
   *  (contextWindow, maxTokens, reasoning, input, compat, …). */
  customModel?: Record<string, unknown>;
}

/** Admin grade→model mapping: one choice per grade. */
export type LlmGradeAssignments = Partial<Record<LlmGrade, LlmModelChoice>>;

/**
 * Agents that consume workspace model config. Benchmark/eval agents are
 * deliberately absent — they ride the analyst policy.
 */
export type LlmAgentKey = 'analyst' | 'web-analyst' | 'slack' | 'report' | 'micro';
export const LLM_AGENT_KEYS: readonly LlmAgentKey[] = ['analyst', 'web-analyst', 'slack', 'report', 'micro'];

/** An agent's grade policy: what the user may pick + what runs by default. */
export interface LlmAgentPolicy {
  allowedGrades: LlmGrade[];
  defaultGrade: LlmGrade;
}

/**
 * Built-in agent policies — the single source of truth under sparse config
 * overrides (`LlmConfig.agents`). Shared by server resolution, validation,
 * the grade catalog, and the settings UI.
 */
export const DEFAULT_AGENT_POLICIES: Record<LlmAgentKey, LlmAgentPolicy> = {
  // Lite is micro-only by default: the analyst-family agents run real
  // analysis, where a haiku-class model underperforms. Admins can widen this
  // per agent in Settings → Models.
  analyst: { allowedGrades: ['core', 'advanced'], defaultGrade: 'core' },
  'web-analyst': { allowedGrades: ['core', 'advanced'], defaultGrade: 'core' },
  slack: { allowedGrades: ['core', 'advanced'], defaultGrade: 'core' },
  report: { allowedGrades: ['core', 'advanced'], defaultGrade: 'core' },
  micro: { allowedGrades: ['lite'], defaultGrade: 'lite' },
};

/** The `llm` section of the org config. */
export interface LlmConfig {
  providers?: LlmProviderEntry[];
  /**
   * Grade→model mapping. A grade with no mapping falls back to the minusx
   * provider if one is configured (fully managed — the gateway routes the
   * grade); otherwise resolving that grade is an error.
   */
  grades?: LlmGradeAssignments;
  /** Sparse per-agent policy overrides, merged over `DEFAULT_AGENT_POLICIES`. */
  agents?: Partial<Record<LlmAgentKey, Partial<LlmAgentPolicy>>>;
}

/**
 * The effective grade policy for an agent: config override merged over the
 * built-in default. Always coherent — `defaultGrade` is forced into
 * `allowedGrades` when a hand-edited config disagrees.
 */
export function resolveAgentPolicy(config: LlmConfig | undefined, agent: LlmAgentKey): LlmAgentPolicy {
  const base = DEFAULT_AGENT_POLICIES[agent];
  const override = config?.agents?.[agent];
  const defaultGrade = override?.defaultGrade ?? base.defaultGrade;
  const allowedGrades = override?.allowedGrades?.length ? override.allowedGrades : base.allowedGrades;
  return {
    defaultGrade,
    allowedGrades: allowedGrades.includes(defaultGrade) ? allowedGrades : [...allowedGrades, defaultGrade],
  };
}

/** One grade entry in the chat picker. GRADES ONLY — which provider/model a
 *  grade resolves to is a behind-the-scenes concern end users never see. */
export interface ChatGradeOption {
  grade: LlmGrade;
  /** False when picking this grade would error (no mapping, no minusx provider). */
  configured: boolean;
}

/** Grade-picker payload. Omitting an override remains the source of truth for
 *  running on the agent's default grade (`defaultGrade`). */
export interface ChatGradeCatalog {
  defaultGrade: LlmGrade;
  grades: ChatGradeOption[];
}

/** Find a provider entry by name. */
export function findLlmProvider(config: LlmConfig | undefined, name: string): LlmProviderEntry | undefined {
  return config?.providers?.find(p => p.name === name);
}

/** The configured minusx provider entry, if any. */
export function findMinusxProvider(config: LlmConfig | undefined): LlmProviderEntry | undefined {
  return config?.providers?.find(p => p.provider === MINUSX_PROVIDER);
}
