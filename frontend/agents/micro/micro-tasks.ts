import type { LlmGrade } from '@/lib/llm/llm-config-types';

/**
 * A named single-turn LLM use-case (title, description, summary, …). The
 * registry is the single source of truth for what micro-tasks exist; callers
 * reference a task by its key (`runMicroTask('title', …)`) rather than wiring a
 * bespoke agent class per use-case.
 *
 * Prompt keys resolve under `prompts.micro.*` in `orchestrator/prompts/prompts.yaml`
 * (e.g. `micro.title.system` / `micro.title.user`). Variables in those templates
 * are filled from the caller's `vars`.
 */
export interface MicroTaskConfig {
  /** Registry key, also used as the `task` tag on the LLM_CALL tracking event. */
  key: string;
  /** Prompt id for the system prompt (e.g. `micro.title.system`). */
  systemPromptKey: string;
  /** Prompt id for the user prompt (e.g. `micro.title.user`). */
  userPromptKey: string;
  /**
   * Code-owned grade override for tasks that need a stronger model class than
   * micro's default (`lite`), e.g. the visual rubric judge. Not bounded by the
   * user-facing agent policy — but the grade must be mapped in Settings →
   * Models (or the minusx provider configured) to resolve.
   */
  grade?: LlmGrade;
}

function task(key: string, grade?: LlmGrade): MicroTaskConfig {
  return { key, systemPromptKey: `micro.${key}.system`, userPromptKey: `micro.${key}.user`, ...(grade ? { grade } : {}) };
}

/**
 * Seed tasks. Add a new use-case here + its `micro.<key>.{system,user}` prompts
 * in `prompts.yaml`; no new agent class needed. Pass a grade as the second arg
 * to run a task on a stronger model class than the micro default.
 */
export const MICRO_TASKS: Record<string, MicroTaskConfig> = {
  title: task('title'),
  description: task('description'),
  feed_summary: task('feed_summary'),
  rubric_llm: task('rubric_llm', 'core'),
};

export function getMicroTask(key: string): MicroTaskConfig {
  const cfg = MICRO_TASKS[key];
  if (!cfg) {
    throw new Error(`Unknown micro-task '${key}'. Known tasks: ${Object.keys(MICRO_TASKS).join(', ')}`);
  }
  return cfg;
}
