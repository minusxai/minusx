// WebAnalystAgent unit tests:
//   - orchestrator pause/resume across UIE-throwing frontend tools (EditFile)
//   - LoadSkill server-side system-skill resolution + frontend deferral
//
// Merged from the former web-analyst.test.ts + load-skill.test.ts (same agent,
// same module graph) to amortize the per-file import.

import { Orchestrator } from '@/orchestrator/orchestrator';
import { UserInputException } from '@/orchestrator/types';
import {
  WebAnalystAgent,
  EditFile,
  CreateFile,
  LoadSkill,
  fauxRegistration,
} from '../web-analyst';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import type { TextContent, ToolResultMessage } from '@/orchestrator/llm';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';

const ctx: RemoteAnalystContext = { userId: 'u', mode: 'org' };

function payloadOf(content: { type: string }[]): Record<string, unknown> {
  return JSON.parse((content[0] as TextContent).text);
}

describe('WebAnalystAgent — UIE pause/resume bridge', () => {
  it('pauses on EditFile, resumes on synthetic ToolResultMessage, finishes on stop', async () => {
    const editFileCallId = 'call_edit_001';

    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('EditFile', { fileId: 1, changes: [{ oldMatch: 'foo', newMatch: 'bar' }] }, { id: editFileCallId })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Edited file 1.', { stopReason: 'stop' }),
    ]);

    const registrables = [EditFile, CreateFile, WebAnalystAgent];

    // 1. First run: faux returns EditFile call → tool throws UIE → orchestrator pauses.
    const orch = new Orchestrator(registrables);
    const agent = new WebAnalystAgent(orch, { userMessage: 'rename foo to bar in file 1' }, ctx);
    const stream = orch.run(agent);
    const events: unknown[] = [];
    for await (const ev of stream) events.push(ev);
    await stream.result();

    const pendingEvent = events.find(
      (e): e is { type: 'pending'; id: string; name: string } =>
        typeof e === 'object' && e !== null && (e as { type?: string }).type === 'pending',
    );
    expect(pendingEvent).toBeDefined();
    expect(pendingEvent!.name).toBe('EditFile');
    expect(pendingEvent!.id).toBe(editFileCallId);

    const pending = orch.getPendingToolCalls();
    expect(pending).toHaveLength(1);
    expect(pending[0].name).toBe('EditFile');

    // 2. Resume: build a synthetic ToolResultMessage as the bridge would.
    const trm: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: editFileCallId,
      toolName: 'EditFile',
      content: [{ type: 'text', text: 'Edit applied successfully.' }],
      isError: false,
      timestamp: Date.now(),
    };

    const orch2 = new Orchestrator(registrables, orch.log);
    const stream2 = orch2.resume([trm]);
    for await (const _ of stream2) { /* drain */ }
    const finalMsg = await stream2.result();

    expect(finalMsg).not.toBeNull();
    expect(finalMsg!.stopReason).toBe('stop');
    const finalText = finalMsg!.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    expect(finalText).toContain('Edited file 1');
  });
});

describe('LoadSkill tool', () => {
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
