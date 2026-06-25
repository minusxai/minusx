import {
  renderPrompt as renderFromTree,
  listSkills as listSkillsFromTree,
  getSkill as getSkillFromTree,
  type PromptTree,
} from './prompt-loader';
import prompts from './prompts.yaml';

// `prompts.yaml` is the single human-edited source of truth (block scalars → real
// newlines, no \n / \" escaping). It is imported NATIVELY and typed as PromptTree
// (see prompts-yaml.d.ts). A yaml loader parses it at BUILD time and inlines the
// object into the bundle — yaml-loader for Turbopack/webpack (next.config.ts) and
// @rollup/plugin-yaml for Vitest — so there is no runtime filesystem read and
// nothing to file-trace: it ships in the standalone Docker bundle exactly like the
// old prompts.json did.
export const PROMPTS: PromptTree = prompts;

export function renderPrompt(promptId: string, vars: Record<string, unknown>): string {
  return renderFromTree(PROMPTS, promptId, vars);
}

export function listSkills(opts: { skipHidden?: boolean } = {}): Record<string, string> {
  return listSkillsFromTree(PROMPTS, opts);
}

export function getSkill(name: string): string | null {
  return getSkillFromTree(PROMPTS, name);
}

export { pyFormat, HIDDEN_SKILLS, type PromptTree } from './prompt-loader';
