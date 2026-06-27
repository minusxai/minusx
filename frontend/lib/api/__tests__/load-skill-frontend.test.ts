// v2's LoadSkill tool resolves SYSTEM skills server-side; when the skill isn't
// a system skill it pauses (UserInputException) and the frontend resolves the
// USER (Knowledge Base) skill. That frontend leg runs through
// executeToolCall('LoadSkill', ...) — so 'LoadSkill' must be registered as a
// frontend tool with the same resolver as the v1 'LoadSkillFrontend' handler.

import { describe, it, expect } from 'vitest';
import { executeToolCall } from '@/lib/api/tool-handlers';
import type { ToolCall } from '@/lib/types';
import type { RootState } from '@/store/store';

function stateWithSkill(skill: Record<string, unknown>): RootState {
  return {
    files: {
      files: {
        5: { id: 5, type: 'context', path: '/org/ctx', name: 'ctx', content: { skills: [skill], fullSkills: [] } },
      },
    },
    chat: {
      conversations: {
        c1: { pending_tool_calls: [{ toolCall: { id: 'tc1' } }], agent_args: { context_path: '/org/question' } },
      },
    },
  } as unknown as RootState;
}

function loadSkillCall(name: string): ToolCall {
  return { id: 'tc1', type: 'function', function: { name: 'LoadSkill', arguments: { name } } };
}

function parse(content: unknown): Record<string, unknown> {
  return typeof content === 'string' ? JSON.parse(content) : (content as Record<string, unknown>);
}

describe("executeToolCall('LoadSkill') — frontend user-skill resolution", () => {
  it('resolves an enabled user skill from the active Knowledge Base context', async () => {
    const state = stateWithSkill({ name: 'my_kb', content: 'KB BODY', description: 'd', enabled: true });
    const msg = await executeToolCall(loadSkillCall('my_kb'), undefined, undefined, state);
    const payload = parse(msg.content);
    expect(payload.success).toBe(true);
    expect(payload.skill).toBe('my_kb');
    expect(payload.content).toBe('KB BODY');
  });

  it('returns an error for a disabled user skill', async () => {
    const state = stateWithSkill({ name: 'off_kb', content: 'X', enabled: false });
    const msg = await executeToolCall(loadSkillCall('off_kb'), undefined, undefined, state);
    expect(parse(msg.content).success).toBe(false);
  });

  it('returns an error when the skill name is missing', async () => {
    const state = stateWithSkill({ name: 'my_kb', content: 'KB BODY', enabled: true });
    const msg = await executeToolCall(loadSkillCall(''), undefined, undefined, state);
    expect(parse(msg.content).success).toBe(false);
  });
});
