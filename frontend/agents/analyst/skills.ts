// Skills selection + rendering for the analyst agent.
// Pure functions over (appState, selected skills, user catalog, unrestricted
// mode) plus the shared prompts.yaml. Kept separate from the agent so each
// piece is unit-testable in isolation.

import type { AgentSkillSelection, AgentUserSkillCatalogItem } from '@/lib/types';
import { HIDDEN_SKILLS, listSkills, getSkill, type PromptTree } from '@/orchestrator/prompts/prompt-loader';

/** Page type → skills preloaded into the system prompt. */
export const PAGE_SKILL_MAP: Record<string, string[]> = {
  question: ['questions'],
  questionv2: ['questions'],
  dashboard: ['dashboards', 'questions'],
  context: ['contexts'],
  report: ['reports'],
  alert: ['alerts'],
  explore: ['explore'],
  folder: ['explore'],
  slack: ['explore'],
  story: ['data_stories', 'questions'],
  storyv2: ['data_stories', 'questions'],
  notebook: ['notebooks', 'questions'],
};

/** Used when the page type is unknown or null. */
export const DEFAULT_PRELOADED_SKILLS = ['questions', 'explore'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * Extract the page type from app_state. `app_state.type` is 'file', 'folder',
 * 'explore', or 'slack'. For files the actual type is at
 * `app_state.state.fileState.type`.
 */
export function getPageType(appState: unknown): string | null {
  const state = asRecord(appState);
  if (!state) return null;
  const topType = state.type;
  if (topType === 'explore' || topType === 'folder' || topType === 'slack') return topType;
  if (topType === 'file') {
    const fileState = asRecord(asRecord(state.state)?.fileState);
    const fileType = fileState?.type;
    return typeof fileType === 'string' ? fileType : null;
  }
  return null;
}

/** Which skills to preload, based on page type, selected system skills, and nav mode. */
export function getPreloadedSkillNames(opts: {
  pageType: string | null;
  selected: AgentSkillSelection[];
  unrestrictedMode: boolean;
}): string[] {
  const { pageType, selected, unrestrictedMode } = opts;
  const skills = [...(pageType && PAGE_SKILL_MAP[pageType] ? PAGE_SKILL_MAP[pageType] : DEFAULT_PRELOADED_SKILLS)];
  for (const sel of selected) {
    if (sel.type !== 'system') continue;
    const name = sel.name;
    if (name && !skills.includes(name) && !HIDDEN_SKILLS.has(name)) skills.push(name);
  }
  skills.push(unrestrictedMode ? 'navigation_unrestricted' : 'navigation_restricted');
  return skills;
}

/** Build the LoadSkill catalog, excluding already-preloaded/selected/hidden skills. */
export function buildSkillsCatalog(opts: {
  tree: PromptTree;
  preloaded: Set<string>;
  selected: AgentSkillSelection[];
  userCatalog: AgentUserSkillCatalogItem[];
}): string {
  const { tree, preloaded, selected, userCatalog } = opts;
  const excluded = new Set([...preloaded, ...HIDDEN_SKILLS]);

  const systemLines: string[] = [];
  for (const [name, description] of Object.entries(listSkills(tree, { skipHidden: true }))) {
    if (!excluded.has(name)) systemLines.push(`  - \`"${name}"\` — ${description}`);
  }

  const selectedUserNames = new Set(
    selected.filter((s) => s.type === 'user').map((s) => s.name),
  );
  const userLines: string[] = [];
  for (const skill of userCatalog) {
    if (!skill.name || selectedUserNames.has(skill.name)) continue;
    userLines.push(`  - \`"${skill.name}"\` — ${skill.description ?? ''}`);
  }

  const sections: string[] = [];
  if (systemLines.length) sections.push('System-defined skills:\n' + systemLines.join('\n'));
  if (userLines.length) sections.push('User-defined skills:\n' + userLines.join('\n'));
  if (!sections.length) return 'No additional skills are available for this turn.';
  return sections.join('\n');
}

/** Resolve and concatenate the content of preloaded skills (+ selected user skills). */
export function buildPreloadedSkillsContent(opts: {
  tree: PromptTree;
  skillNames: string[];
  selected: AgentSkillSelection[];
}): string {
  const { tree, skillNames, selected } = opts;
  const sections: string[] = [];
  for (const name of skillNames) {
    const content = getSkill(tree, name);
    if (content) sections.push(content);
  }
  for (const skill of selected) {
    if (skill.type !== 'user' || !skill.content) continue;
    sections.push(`## Instructions: ${skill.name || 'user_skill'} (user-defined)\n${skill.content}`);
  }
  return sections.join('\n\n');
}
