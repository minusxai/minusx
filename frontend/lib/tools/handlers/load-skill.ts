/**
 * Resolve a user-defined Knowledge Base skill from the active conversation's
 * already-loaded context state. Shared by two tool names:
 *  - 'LoadSkillFrontend' — spawned by the server-side LoadSkill for user-defined skills
 *  - 'LoadSkill'         — v2 (the LoadSkill tool resolves system skills
 *    server-side and pauses to here for user-defined skills)
 */
import type { ContextContent } from '@/lib/types';
import { selectContextFromPath, selectMergedContent } from '@/store/filesSlice';
import { mergeSkillsByName } from '@/lib/context/context-utils';
import type { FrontendToolHandler } from './types';

export const resolveUserSkillFrontend: FrontendToolHandler = async (args, context) => {
  const name = String(args.name ?? '');

  if (!name) {
    return {
      content: { success: false, error: 'name is required' },
      details: { success: false, error: 'name is required' }
    };
  }

  if (!context.state) {
    const error = `No active frontend context available to resolve user skill '${name}'`;
    return {
      content: { success: false, error },
      details: { success: false, error }
    };
  }

  if (!context.contextPath) {
    const error = `No active Knowledge Base context available to resolve user skill '${name}'`;
    return {
      content: { success: false, error },
      details: { success: false, error }
    };
  }

  const contextFile = selectContextFromPath(context.state, context.contextPath);
  const content = contextFile
    ? selectMergedContent(context.state, contextFile.id) as ContextContent | undefined
    : undefined;

  if (!content) {
    const error = `Active Knowledge Base context is not loaded for user skill '${name}'`;
    return {
      content: { success: false, error },
      details: { success: false, error }
    };
  }

  const skill = mergeSkillsByName(content.fullSkills || [], content.skills || []).find(s => s.name === name);

  if (!skill) {
    const error = `User skill '${name}' not found in the active Knowledge Base context`;
    return {
      content: { success: false, error },
      details: { success: false, error }
    };
  }

  if (!skill.enabled) {
    const error = `User skill '${skill.name}' is disabled`;
    return {
      content: { success: false, error },
      details: { success: false, error }
    };
  }

  return {
    content: {
      success: true,
      skill: skill.name,
      description: skill.description,
      content: skill.content,
    },
    details: {
      success: true,
      message: `Loaded skill ${skill.name}`,
    }
  };
};
