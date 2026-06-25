import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import {
  renderPrompt as renderFromTree,
  listSkills as listSkillsFromTree,
  getSkill as getSkillFromTree,
  type PromptTree,
} from './prompt-loader';

// `prompts.yaml` is the single human-edited source of truth (block scalars → real
// newlines, no \n / \" escaping). Parsed once here at module load — there is no
// generated JSON artifact and no build step. This module is server-only (agents +
// API routes), so the filesystem read is safe.
//
// `new URL('./prompts.yaml', import.meta.url)` is the nft-friendly pattern: Next's
// file tracer detects it and copies prompts.yaml into the standalone Docker output
// next to this module, where import.meta.url resolves at runtime.
const promptsData = yaml.load(
  readFileSync(new URL('./prompts.yaml', import.meta.url), 'utf8'),
) as Partial<PromptTree>;

export const PROMPTS: PromptTree = {
  templates: promptsData.templates ?? {},
  prompts: promptsData.prompts ?? {},
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
