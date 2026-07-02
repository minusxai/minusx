import type { Api, Model } from '@/orchestrator/llm';

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
  /** Optional per-task model override; defaults to the analyst model. */
  model?: Model<Api>;
}

function task(key: string): MicroTaskConfig {
  return { key, systemPromptKey: `micro.${key}.system`, userPromptKey: `micro.${key}.user` };
}

/**
 * Seed tasks. Add a new use-case here + its `micro.<key>.{system,user}` prompts
 * in `prompts.yaml`; no new agent class needed.
 */
export const MICRO_TASKS: Record<string, MicroTaskConfig> = {
  title: task('title'),
  description: task('description'),
  feed_summary: task('feed_summary'),
  rubric_judge: task('rubric_judge'),
};

export function getMicroTask(key: string): MicroTaskConfig {
  const cfg = MICRO_TASKS[key];
  if (!cfg) {
    throw new Error(`Unknown micro-task '${key}'. Known tasks: ${Object.keys(MICRO_TASKS).join(', ')}`);
  }
  return cfg;
}
