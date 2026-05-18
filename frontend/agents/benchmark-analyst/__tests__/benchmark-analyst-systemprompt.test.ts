/**
 * Tests that `BenchmarkAnalystAgent`'s system prompt:
 *   - wraps `contextDocs` in `<UserContext>`
 *   - reads the `AutoContextAgent` wrapper from `this.toolThread` and embeds
 *     the rendered output under `<GeneratedContext>`
 *   - omits `<GeneratedContext>` when no wrapper is in `this.toolThread`
 *
 * `ensureAutoContext()` is mocked here to push a synthetic wrapper into
 * `this.toolThread` (the cache-hit code path). Real dispatch + cache logic
 * is covered in `v2/auto-context/__tests__/`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fauxAssistantMessage, type Context, type TextContent } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { BenchmarkAnalystAgent, fauxRegistration } from '../benchmark-analyst';
import type { BenchmarkAnalystContext } from '../types';
import {
  buildAutoContextCacheHitWrapper,
  buildAutoContextSynthAssistant,
  type AutoContextPayload,
} from '../v2/auto-context';
import { gen_id } from '@/orchestrator/utils';

const REGISTRABLES = [BenchmarkAnalystAgent];

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'test_db', dialect: 'duckdb', description: 'test', config: { file_path: '/nonexistent/test.duckdb' } },
  ],
  contextDocs: '## doc heading\nUserContext-payload-marker',
  datasetKey: 'test-dataset',
};

const AUTO_CTX_MARKER = 'AUTOCTX_MARKER';
const STUB_PAYLOAD: AutoContextPayload = {
  tables: [{
    connection: 'test_db',
    schema: 'public',
    table: 'tbl_with_marker',
    tableNote: AUTO_CTX_MARKER,
    columns: [],
    joins: [],
  }],
  examples: [],
};

describe('BenchmarkAnalystAgent system prompt', () => {
  let runSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock `ensureAutoContext` to push a synthetic wrapper into
    // `this.toolThread` — same shape `getSystemPrompt()` would see on a
    // cache-hit row in production. This bypasses the real
    // dispatch + cache + connector machinery (covered separately in
    // v2/auto-context/__tests__/).
    runSpy = vi
      .spyOn(BenchmarkAnalystAgent.prototype as unknown as { ensureAutoContext: () => Promise<void> }, 'ensureAutoContext')
      .mockImplementation(async function (this: BenchmarkAnalystAgent) {
        const id = gen_id();
        this.toolThread.push(
          buildAutoContextSynthAssistant(id, '<stub>'),
          buildAutoContextCacheHitWrapper(id, STUB_PAYLOAD),
        );
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
    // Override the default mock: no wrapper pushed at all.
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
