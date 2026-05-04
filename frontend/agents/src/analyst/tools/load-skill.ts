import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/src/tool';
import type { ToolResult } from '@/orchestrator/src/types';
import { getSkill } from '../prompt-loader';

interface Args {
  name?: string;
}

export class LoadSkill extends Tool<Args> {
  readonly name = 'LoadSkill';
  readonly description =
    'Load detailed instructions for a system or user-defined skill. Use `name` for both system skills and user-defined Knowledge Base skills.';
  readonly schema = Type.Object({
    name: Type.Optional(Type.String({ description: "Skill name to load (e.g., 'alerts', 'reports', or a user-defined skill name)." })),
  });

  async run({ name }: Args): Promise<ToolResult> {
    if (!name) {
      return { state: 'failure', error: 'LoadSkill requires a skill name' };
    }
    const content = getSkill(name);
    if (content === null) {
      // Headless default: user-defined KB skills can't be resolved without DB+user context.
      // WebLoadSkillTool overrides this to fetch from the Knowledge Base.
      return { state: 'failure', error: `Skill '${name}' not found` };
    }
    return { state: 'success', content: { skill: name, content } };
  }
}
