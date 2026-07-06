/**
 * Skill loading for agents, with the LIVE per-file-type content schemas injected.
 *
 * `orchestrator/` must stay app-agnostic, so it can't depend on `lib/validation` — the live Atlas
 * schemas live in the app layer. This agents-layer helper is the single place that bridges them:
 * it augments the prompt template tree with `SCHEMA_TEMPLATE_VARS` (`{schema_question}` …) so every
 * skill renders the exact current content schema from code instead of a hand-typed example. All
 * agent skill-loading goes through here — never call the raw `getSkill` directly.
 */
import { PROMPTS } from '@/orchestrator/prompts';
import { getSkill as getSkillFromTree, type PromptTree } from '@/orchestrator/prompts/prompt-loader';
import { SCHEMA_TEMPLATE_VARS } from '@/lib/validation/atlas-json-schemas';

const withSchemas = (tree: PromptTree): PromptTree => ({
  ...tree,
  templates: { ...tree.templates, ...SCHEMA_TEMPLATE_VARS },
});

/** Load a skill by name from the default tree, with live content schemas substituted. */
export function loadSkill(name: string): string | null {
  return getSkillFromTree(withSchemas(PROMPTS), name);
}

/** Load a skill from a caller-provided tree, with live content schemas substituted. */
export function loadSkillFromTree(tree: PromptTree, name: string): string | null {
  return getSkillFromTree(withSchemas(tree), name);
}
