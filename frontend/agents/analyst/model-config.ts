/**
 * Static agent model wiring.
 *
 * Model config is DB-ONLY: the org config's `llm` section (Settings → Models /
 * setup wizard), resolved per LLM call by `Orchestrator.resolveLlmPlan`
 * (`lib/llm/llm-plan.server.ts`). There is NO env-var model config and no
 * hardcoded provider default — when nothing is configured, every use case
 * routes to the managed MinusX gateway.
 *
 * The statics below are therefore only the SUBSTRATE under that hook:
 *   - test environments (vitest / E2E builds) get the agent's faux model, so
 *     the LLM is deterministic and no network is touched;
 *   - production paths get the MinusX-default handle — matching what the plan
 *     resolver produces for an unconfigured workspace, so hookless contexts
 *     behave identically to tier-3 resolution.
 */
import type { Api, Model } from '@/orchestrator/llm';
import { buildMinusxModel, minusxCallOptions } from '@/lib/llm/minusx-default';
import { E2E_MODE } from '@/lib/constants';

function isTestEnv(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- intentional test-env detection so faux providers stay unreachable in production
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST;
}

/**
 * Resolves the model for an analyst-family agent class, given the agent's faux
 * test model as the **test-only** fallback. Production returns the MinusX
 * default (the per-call plan resolver overrides it with the workspace's real
 * config). This is the **only** sanctioned way an agent class should reference
 * its faux model in its static `model` field — the runtime guard makes "no
 * faux models in production" a code-enforced invariant.
 */
export function getAgentModelOrTestFallback(testFallback: Model<Api>): Model<Api> {
  if (isTestEnv() || E2E_MODE) return testFallback;
  return buildMinusxModel();
}

/**
 * Static call options for analyst-family agents: the MinusX use-case routing
 * header in production, nothing in tests. Per-workspace options (reasoning,
 * apiKey, …) come from the DB plan and merge over these at call time.
 */
export function getAnalystModelOptions(): Record<string, unknown> | undefined {
  if (isTestEnv() || E2E_MODE) return undefined;
  return minusxCallOptions('analyst');
}
