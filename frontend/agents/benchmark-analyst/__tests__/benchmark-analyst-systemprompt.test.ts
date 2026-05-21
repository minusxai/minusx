/**
 * Tests that `BenchmarkAnalystAgent`'s system prompt:
 *   - wraps `contextDocs` in `<UserContext>`
 *   - reads `ctx.autoContextRendered` (or `ctx.autoContextBySlot`) and
 *     embeds the rendered output under `<GeneratedContext>`
 *   - omits `<GeneratedContext>` when neither field is set
 *
 * AutoContext is now a standalone runner pre-step — the agent just reads
 * from its context. Real dispatch + cache + verification logic is covered
 * in `v2/auto-context/__tests__/auto-context.integration.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import type { Context, TextContent } from '@/orchestrator/llm';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { BenchmarkAnalystAgent, fauxRegistration } from '../benchmark-analyst';
import type { BenchmarkAnalystContext } from '../types';

const REGISTRABLES = [BenchmarkAnalystAgent];

const AUTO_CTX_MARKER = 'AUTOCTX_MARKER';

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'test_db', dialect: 'duckdb', description: 'test', config: { file_path: '/nonexistent/test.duckdb' } },
  ],
  contextDocs: '## doc heading\nUserContext-payload-marker',
  datasetKey: 'test-dataset',
  // Simulate the runner having pre-populated auto-context
  autoContextRendered: `## test_db.public.tbl_with_marker — ${AUTO_CTX_MARKER}\n| col | type | stats | description | joins |\n|---|---|---|---|---|\n| col_a | VARCHAR | | | |`,
};

describe('BenchmarkAnalystAgent system prompt', () => {
  async function captureFirstSystemPromptAndUser(
    ctxOverride?: Partial<BenchmarkAnalystContext>,
  ): Promise<{ systemPrompt: string; userContent: TextContent[] | string }> {
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: stub answer', { stopReason: 'stop' }),
    ]);
    const orch = new Orchestrator(REGISTRABLES);
    const ctx = ctxOverride ? { ...CTX, ...ctxOverride } : CTX;
    const root = new BenchmarkAnalystAgent(orch, { userMessage: 'find the thing' }, ctx);
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

  it('reads autoContextRendered from context and embeds it under <GeneratedContext>', async () => {
    const { systemPrompt } = await captureFirstSystemPromptAndUser();

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

  it('omits <GeneratedContext> when autoContextRendered is not set', async () => {
    const { systemPrompt } = await captureFirstSystemPromptAndUser({
      autoContextRendered: undefined,
      autoContextBySlot: undefined,
    });
    expect(systemPrompt).not.toContain('<GeneratedContext>');
    expect(systemPrompt).toContain('<UserContext>');
  });

  it('omits <GeneratedContext> for production path (no datasetKey, no auto-context)', async () => {
    const { systemPrompt } = await captureFirstSystemPromptAndUser({
      datasetKey: undefined,
      autoContextRendered: undefined,
      autoContextBySlot: undefined,
    });
    expect(systemPrompt).not.toContain('<GeneratedContext>');
    expect(systemPrompt).toContain('<UserContext>');
  });
});
