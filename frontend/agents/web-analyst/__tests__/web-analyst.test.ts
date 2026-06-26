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
  LoadContext,
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

describe('LoadContext tool', () => {
  const libCtx: RemoteAnalystContext = {
    userId: 'u',
    mode: 'org',
    contextDocsLibrary: [
      { key: 'glossary', title: 'Glossary', description: 'terms', content: 'GLOSSARY BODY' },
      { key: 'cohorts', title: 'Cohorts', description: 'cohort logic', content: 'COHORTS BODY' },
      { key: 'billing', title: 'Billing', description: 'billing rules', content: 'BILLING BODY' },
      { key: 'pricing', title: 'Pricing', description: 'price book', content: 'PRICING BODY' },
      { key: 'refunds', title: 'Refunds', description: 'refund policy', content: 'REFUNDS BODY' },
    ],
  };

  it('returns the full content of the requested docs by key', async () => {
    const orch = new Orchestrator([], []);
    const tool = new LoadContext(orch, { keys: ['glossary'] }, libCtx);
    const res = await tool.run();
    const payload = payloadOf((res as { content: { type: string }[] }).content);
    expect(payload.success).toBe(true);
    expect(payload.docs).toEqual([{ key: 'glossary', title: 'Glossary', content: 'GLOSSARY BODY' }]);
    expect(payload.missing).toBeUndefined();
    expect(payload.warning).toBeUndefined();
  });

  it('falls back to resolving by (unique) human title when the agent passes that instead of the key', async () => {
    const orch = new Orchestrator([], []);
    const tool = new LoadContext(orch, { keys: ['Glossary'] }, libCtx);
    const res = await tool.run();
    const payload = payloadOf((res as { content: { type: string }[] }).content);
    expect(payload.success).toBe(true);
    expect(payload.docs).toEqual([{ key: 'glossary', title: 'Glossary', content: 'GLOSSARY BODY' }]);
  });

  it('reports unknown keys in `missing` without failing', async () => {
    const orch = new Orchestrator([], []);
    const tool = new LoadContext(orch, { keys: ['glossary', 'Nope'] }, libCtx);
    const res = await tool.run();
    const payload = payloadOf((res as { content: { type: string }[] }).content);
    expect(payload.success).toBe(true);
    expect(payload.missing).toEqual(['Nope']);
    expect((res as { isError: boolean }).isError).toBe(false);
  });

  it('errors (without resolving) when keys is empty', async () => {
    const orch = new Orchestrator([], []);
    const tool = new LoadContext(orch, { keys: [] }, libCtx);
    const res = await tool.run();
    const payload = payloadOf((res as { content: { type: string }[] }).content);
    expect(payload.success).toBe(false);
    expect((res as { isError: boolean }).isError).toBe(true);
  });

  it('errors when no context library is available', async () => {
    const orch = new Orchestrator([], []);
    const tool = new LoadContext(orch, { keys: ['glossary'] }, ctx);
    const res = await tool.run();
    const payload = payloadOf((res as { content: { type: string }[] }).content);
    expect(payload.success).toBe(false);
  });

  it('adds an over-fetch warning at the absolute key threshold (5)', async () => {
    const orch = new Orchestrator([], []);
    const tool = new LoadContext(orch, { keys: ['glossary', 'cohorts', 'billing', 'pricing', 'refunds'] }, libCtx);
    const res = await tool.run();
    const payload = payloadOf((res as { content: { type: string }[] }).content);
    expect(payload.success).toBe(true);
    expect(payload.docs).toHaveLength(5);
    expect(typeof payload.warning).toBe('string');
  });

  it('does not warn below the threshold', async () => {
    const orch = new Orchestrator([], []);
    const tool = new LoadContext(orch, { keys: ['glossary', 'cohorts', 'billing'] }, libCtx);
    const res = await tool.run();
    const payload = payloadOf((res as { content: { type: string }[] }).content);
    expect(payload.docs).toHaveLength(3);
    expect(payload.warning).toBeUndefined();
  });

  it('is advertised to the LLM in the WebAnalystAgent toolset', () => {
    const names = WebAnalystAgent.tools.map((t) => t.name);
    expect(names).toContain('LoadContext');
  });

  it('auto-executes server-side in a full run — the resolved content lands in the log', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('LoadContext', { keys: ['glossary'] }, { id: 'call_lc_1' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Loaded the glossary.', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator([LoadContext, WebAnalystAgent]);
    const agent = new WebAnalystAgent(orch, { userMessage: 'what does revenue mean?' }, libCtx);
    const stream = orch.run(agent);
    for await (const _ of stream) { /* drain */ }
    const finalMsg = await stream.result();

    // LoadContext is a pure server tool → no pause; it ran and its result is logged.
    expect(orch.getPendingToolCalls()).toHaveLength(0);
    const toolResult = orch.log.find(
      (m) => (m as { role?: string }).role === 'toolResult' && (m as { toolName?: string }).toolName === 'LoadContext',
    ) as ToolResultMessage | undefined;
    expect(toolResult).toBeDefined();
    const payload = payloadOf(toolResult!.content as { type: string }[]);
    expect(payload.success).toBe(true);
    expect((payload.docs as { content: string }[])[0].content).toBe('GLOSSARY BODY');
    expect(finalMsg!.stopReason).toBe('stop');
  });
});
