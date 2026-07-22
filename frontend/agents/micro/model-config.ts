/**
 * MicroAgent static model wiring — see `agents/analyst/model-config.ts` for
 * the full rationale. Model config is DB-only (org config `llm` section,
 * resolved per call by `Orchestrator.resolveLlmPlan`); these statics are the
 * substrate under that hook: faux in test envs, the MinusX default otherwise
 * (with the `micro` use-case routing header).
 */
import type { Api, Model } from '@/orchestrator/llm';
import { buildMinusxModel, minusxCallOptions } from '@/lib/llm/minusx-default';
import { E2E_MODE } from '@/lib/constants';

function isTestEnv(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- intentional test-env detection so faux providers stay unreachable in production
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST;
}

/** MicroAgent's static model: faux in tests/E2E, MinusX default in production. */
export function getMicroModelOrTestFallback(testFallback: Model<Api>): Model<Api> {
  if (isTestEnv() || E2E_MODE) return testFallback;
  return buildMinusxModel();
}

/** Static call options: the `lite` grade routing header in production. */
export function getMicroModelOptions(): Record<string, unknown> | undefined {
  if (isTestEnv() || E2E_MODE) return undefined;
  return minusxCallOptions('lite');
}
