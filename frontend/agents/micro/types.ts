import type { RemoteAnalystContext } from '@/agents/analyst/types';

/**
 * Context for a {@link MicroAgent} run. A micro-task is a single, no-tools LLM
 * call identified by `taskKey` (looked up in `MICRO_TASKS`); `vars` are the
 * template variables substituted into that task's system/user prompts.
 *
 * Extends `RemoteAnalystContext` so the agent can reuse the analyst model
 * resolution + message projection, but micro-tasks deliberately set none of the
 * analyst-specific fields (schema, skills, appState) — everything the prompt
 * needs comes through `vars`.
 */
export interface MicroAgentContext extends RemoteAnalystContext {
  taskKey: string;
  vars: Record<string, string>;
}
