// WebAnalystAgent: orchestrator pause/resume across UIE-throwing frontend tools.
//
// Mirrors the existing `analyst/__tests__/runner.test.ts` faux pattern: faux
// LLM emits a tool call (EditFile), the tool throws UserInputException, the
// orchestrator pauses, we synthesize a ToolResultMessage and resume, the faux
// emits a stop turn, the agent finishes.

import { Orchestrator } from '@/orchestrator/orchestrator';
import {
  WebAnalystAgent,
  EditFile,
  CreateFile,
  DeleteFile,
  fauxRegistration,
} from '../web-analyst';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import {
  fauxAssistantMessage,
  fauxToolCall,
  type ToolResultMessage,
} from '@mariozechner/pi-ai';

const ctx: RemoteAnalystContext = { userId: 'u', mode: 'org' };

describe('WebAnalystAgent — UIE pause/resume bridge', () => {
  it('pauses on EditFile, resumes on synthetic ToolResultMessage, finishes on stop', async () => {
    const editFileCallId = 'call_edit_001';

    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('EditFile', { fileId: 1, oldStr: 'foo', newStr: 'bar' }, { id: editFileCallId })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Edited file 1.', { stopReason: 'stop' }),
    ]);

    const registrables = [EditFile, CreateFile, DeleteFile, WebAnalystAgent];

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
