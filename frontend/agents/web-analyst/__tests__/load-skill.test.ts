// LoadSkill is the LLM-facing tool (matching Python + what the skill docs tell
// the model to call). It resolves SYSTEM skills server-side via getSkill (from
// the shared prompts.yaml) and defers USER skills to the frontend (the model
// can't tell them apart — it just passes a name). Python is the reference:
// tasks/agents/analyst/tools.py → LoadSkill.

import { describe, it, expect } from 'vitest';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { UserInputException } from '@/orchestrator/types';
import type { TextContent } from '@/orchestrator/llm';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import { LoadSkill, WebAnalystAgent } from '../web-analyst';

const ctx: RemoteAnalystContext = { userId: 'u', mode: 'org' };

function payloadOf(content: { type: string }[]): Record<string, unknown> {
  return JSON.parse((content[0] as TextContent).text);
}

describe('LoadSkill tool (parity with Python LoadSkill)', () => {
  it('resolves a system skill server-side and returns its content', async () => {
    const orch = new Orchestrator([], []);
    const tool = new LoadSkill(orch, { name: 'visualizations' }, ctx);
    const res = await tool.run();
    if (res instanceof Object && 'role' in res) throw new Error('expected ToolResponse');
    const payload = payloadOf((res as { content: { type: string }[] }).content);
    expect(payload.success).toBe(true);
    expect(payload.skill).toBe('visualizations');
    expect(String(payload.content)).toContain('## Instructions: Visualizations');
  });

  it('defers unknown (user-defined) skills to the frontend via UserInputException', async () => {
    const orch = new Orchestrator([], []);
    const tool = new LoadSkill(orch, { name: 'a_user_kb_skill_that_is_not_in_yaml' }, ctx);
    await expect(tool.run()).rejects.toBeInstanceOf(UserInputException);
  });

  it('returns an error (without pausing) when no name is given', async () => {
    const orch = new Orchestrator([], []);
    const tool = new LoadSkill(orch, { name: '' }, ctx);
    const res = await tool.run();
    const payload = payloadOf((res as { content: { type: string }[] }).content);
    expect(payload.success).toBe(false);
  });

  it('is advertised to the LLM as `LoadSkill` (not `LoadSkillFrontend`)', () => {
    const names = WebAnalystAgent.tools.map((t) => t.name);
    expect(names).toContain('LoadSkill');
    expect(names).not.toContain('LoadSkillFrontend');
  });
});
