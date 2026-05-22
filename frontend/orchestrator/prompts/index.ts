import promptsJson from './prompts.json';
import {
  renderPrompt as renderFromTree,
  listSkills as listSkillsFromTree,
  getSkill as getSkillFromTree,
  type PromptTree,
} from './prompt-loader';

// Frozen analyst prompts, imported straight into the bundle (the backend
// prompts.yaml is obsolete — chat is moving to v2). No filesystem read, so the
// frontend standalone Docker image renders prompts with no backend/ tree.
export const PROMPTS: PromptTree = {
  templates: (promptsJson as Partial<PromptTree>).templates ?? {},
  prompts: (promptsJson as Partial<PromptTree>).prompts ?? {},
};

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
