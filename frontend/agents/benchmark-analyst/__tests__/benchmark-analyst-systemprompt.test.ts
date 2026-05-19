/**
 * Tests that `BenchmarkAnalystAgent`'s system prompt:
 *   - wraps `contextDocs` in `<UserContext>`
 *   - reads the `AutoContextAgent` wrapper from `this.toolThread` and embeds
 *     the rendered output under `<GeneratedContext>`
 *   - omits `<GeneratedContext>` when no wrapper is in `this.toolThread`
 *
 * The module-level `ensureAutoContext` is spied here to push a synthetic
 * wrapper onto `this.toolThread` (mimicking the cache-hit path). Real
 * dispatch + cache + verification logic is covered in
 * `v2/auto-context/__tests__/auto-context.integration.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fauxAssistantMessage, type Context, type TextContent } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { MXAgent } from '@/orchestrator/types';
import { BenchmarkAnalystAgent, fauxRegistration } from '../benchmark-analyst';
import type { BenchmarkAnalystContext } from '../types';
import * as autoContextModule from '../v2/auto-context/auto-context';

const REGISTRABLES = [BenchmarkAnalystAgent];

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'test_db', dialect: 'duckdb', description: 'test', config: { file_path: '/nonexistent/test.duckdb' } },
  ],
  contextDocs: '## doc heading\nUserContext-payload-marker',
  datasetKey: 'test-dataset',
};

const AUTO_CTX_MARKER = 'AUTOCTX_MARKER';

// Manually craft the wrapper details so the test doesn't depend on the
// dispatch + verification flow (covered elsewhere).
function pushSyntheticWrapper(parent: MXAgent): void {
  const wrapper = {
    role: 'toolResult' as const,
    toolCallId: 'autoctx-stub',
    toolName: autoContextModule.AutoContextAgent.schema.name,
    content: [{ type: 'text' as const, text: 'stub' }],
    isError: false,
    details: {
      type: 'auto_context_render_state',
      schema: [
        { connection: 'test_db', schema: 'public', table: 'tbl_with_marker', column: 'col_a', type: 'VARCHAR' },
      ],
      statsEntries: [],
      rowCountEntries: [],
      payload: {
        annotations: [
          // Description targeting the table id ("t0" — only one table in the schema).
          { id: 't0', description: AUTO_CTX_MARKER },
        ],
      },
    },
    timestamp: Date.now(),
  };
  parent.toolThread.push(wrapper);
}

describe('BenchmarkAnalystAgent system prompt', () => {
  let runSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    runSpy = vi
      .spyOn(autoContextModule, 'ensureAutoContext')
      .mockImplementation(async (parent) => {
        pushSyntheticWrapper(parent);
      });
  });

  async function captureFirstSystemPromptAndUser(): Promise<{
    systemPrompt: string;
    userContent: TextContent[] | string;
  }> {
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: stub answer', { stopReason: 'stop' }),
    ]);
    const orch = new Orchestrator(REGISTRABLES);
    const root = new BenchmarkAnalystAgent(orch, { userMessage: 'find the thing' }, CTX);
    let systemPrompt: string | undefined;
    let userContent: TextContent[] | string = '';
    const origCall = orch.callLLM.bind(orch);
    orch.callLLM = async (m, c: Context, id, opts) => {
      if (systemPrompt === undefined) {
        systemPrompt = c.systemPrompt;
        const userMsg = c.messages.find((msg) => msg.role === 'user');
        userContent = (userMsg?.content ?? '') as TextContent[] | string;
      }
      return origCall(m, c, id, opts);
    };
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();
    return { systemPrompt: systemPrompt ?? '', userContent };
  }

  it('reads the AutoContext wrapper from this.toolThread and embeds it under <GeneratedContext>', async () => {
    const { systemPrompt } = await captureFirstSystemPromptAndUser();
    expect(runSpy).toHaveBeenCalledTimes(1);

    expect(systemPrompt).toMatch(/<UserContext>[\s\S]*UserContext-payload-marker[\s\S]*<\/UserContext>/);
    expect(systemPrompt).toMatch(new RegExp(`<GeneratedContext>[\\s\\S]*${AUTO_CTX_MARKER}[\\s\\S]*</GeneratedContext>`));
    // UserContext appears before GeneratedContext.
    expect(systemPrompt.indexOf('<UserContext>')).toBeLessThan(systemPrompt.indexOf('<GeneratedContext>'));
  });

  it('includes the analysis guideline distinguishing UserContext vs GeneratedContext', async () => {
    const { systemPrompt } = await captureFirstSystemPromptAndUser();
    expect(systemPrompt).toMatch(/UserContext.*authoritative|authoritative.*UserContext/i);
    expect(systemPrompt).toMatch(/GeneratedContext/);
  });

  it('omits <GeneratedContext> when ensureAutoContext does not push a wrapper to toolThread', async () => {
    runSpy.mockImplementation(async () => { /* no-op */ });
    const { systemPrompt } = await captureFirstSystemPromptAndUser();
    expect(systemPrompt).not.toContain('<GeneratedContext>');
    expect(systemPrompt).toContain('<UserContext>');
  });

  it('omits <GeneratedContext> when ensureAutoContext throws (best-effort orientation)', async () => {
    runSpy.mockRejectedValue(new Error('simulated AutoContext failure'));
    const { systemPrompt } = await captureFirstSystemPromptAndUser();
    expect(systemPrompt).not.toContain('<GeneratedContext>');
    expect(systemPrompt).toContain('<UserContext>');
  });

  it('skips ensureAutoContext entirely when ctx.datasetKey is unset (production path)', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: stub', { stopReason: 'stop' }),
    ]);
    const orch = new Orchestrator(REGISTRABLES);
    const ctxNoDataset = { ...CTX };
    delete ctxNoDataset.datasetKey;
    const root = new BenchmarkAnalystAgent(orch, { userMessage: 'q' }, ctxNoDataset);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();
    expect(runSpy).not.toHaveBeenCalled();
  });
});
