import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderPrompt as renderFromFile,
  listSkills as listSkillsFromFile,
  getSkill as getSkillFromFile,
} from './prompt-loader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PROMPTS_PATH = path.resolve(
  __dirname,
  '../../../backend/tasks/agents/analyst/prompts.yaml',
);

export function getPromptsPath(): string {
  // eslint-disable-next-line no-restricted-syntax -- orchestrator is a standalone module; avoid coupling to lib/config for one optional dev override
  return process.env.MX_PROMPTS_PATH ?? DEFAULT_PROMPTS_PATH;
}

export function renderPrompt(
  promptId: string,
  vars: Record<string, unknown>,
): string {
  return renderFromFile(getPromptsPath(), promptId, vars);
}

export { loadPrompts, clearPromptCache, pyFormat, HIDDEN_SKILLS } from './prompt-loader';

/** List skills from the active prompts.yaml (see prompt-loader.listSkills). */
export function listSkills(opts: { skipHidden?: boolean } = {}): Record<string, string> {
  return listSkillsFromFile(getPromptsPath(), opts);
}

/** Resolve a skill's content from the active prompts.yaml (see prompt-loader.getSkill). */
export function getSkill(name: string): string | null {
  return getSkillFromFile(getPromptsPath(), name);
}
