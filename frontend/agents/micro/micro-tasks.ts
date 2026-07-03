/**
 * Which existing model config a micro-task runs on. `micro` = the cheap default
 * (`MICRO_AGENT_MODEL_CONFIG`) for low-stakes single-turn helpers; `analyst` = the heavier
 * `ANALYST_AGENT_MODEL_CONFIG` for tasks that need a stronger model (e.g. the visual rubric judge).
 * No new env var — a task just picks one of the two configs already wired for agents.
 */
export type MicroModelSource = 'micro' | 'analyst';

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
  /** Which model config to run on (`micro` default / `analyst`). */
  modelSource: MicroModelSource;
}

function task(key: string, modelSource: MicroModelSource = 'micro'): MicroTaskConfig {
  return { key, systemPromptKey: `micro.${key}.system`, userPromptKey: `micro.${key}.user`, modelSource };
}

/**
 * Seed tasks. Add a new use-case here + its `micro.<key>.{system,user}` prompts
 * in `prompts.yaml`; no new agent class needed. Pass `'analyst'` as the second arg to run a task
 * on the stronger analyst model instead of the cheap micro default.
 */
export const MICRO_TASKS: Record<string, MicroTaskConfig> = {
  title: task('title'),
  description: task('description'),
  feed_summary: task('feed_summary'),
  rubric_llm: task('rubric_llm', 'analyst'),
};

export function getMicroTask(key: string): MicroTaskConfig {
  const cfg = MICRO_TASKS[key];
  if (!cfg) {
    throw new Error(`Unknown micro-task '${key}'. Known tasks: ${Object.keys(MICRO_TASKS).join(', ')}`);
  }
  return cfg;
}
