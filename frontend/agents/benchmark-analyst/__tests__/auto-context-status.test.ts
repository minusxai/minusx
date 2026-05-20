/**
 * AutoContext is now a standalone runner pre-step (`runAutoContextForSlot`).
 * The runner stamps each row's context with `autoContextRendered` and/or
 * `autoContextBySlot` before dispatching agents.
 *
 * These tests verify that `BenchmarkAnalystAgent.getSystemPrompt()` picks
 * up the rendered auto-context from the context and embeds it in the
 * `<GeneratedContext>` block.
 */
import { describe, it, expect } from 'vitest';
import { fauxAssistantMessage, type Context } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { BenchmarkAnalystAgent, fauxRegistration } from '../benchmark-analyst';
import type { BenchmarkAnalystContext } from '../types';

const REGISTRABLES = [BenchmarkAnalystAgent];

/** Run the agent and capture the system prompt via callLLM interception. */
async function captureSystemPrompt(ctx: BenchmarkAnalystContext): Promise<string> {
  fauxRegistration.setResponses([
    fauxAssistantMessage('done', { stopReason: 'stop' }),
  ]);
  const orch = new Orchestrator(REGISTRABLES);
  const root = new BenchmarkAnalystAgent(orch, { userMessage: 'q' }, ctx);
  let systemPrompt = '';
  const origCall = orch.callLLM.bind(orch);
  orch.callLLM = async (m, c: Context, id, opts) => {
    if (!systemPrompt) {
      systemPrompt = c.systemPrompt ?? '';
    }
    return origCall(m, c, id, opts);
  };
  const stream = orch.run(root);
  for await (const _ev of stream) { /* drain */ }
  await stream.result();
  return systemPrompt;
}

describe('BenchmarkAnalystAgent — auto-context in system prompt', () => {
  it('includes <GeneratedContext> when ctx.autoContextRendered is set', async () => {
    const ctx: BenchmarkAnalystContext = {
      datasetKey: 'd1',
      connections: [{ name: 'c', dialect: 'sqlite' }],
      autoContextRendered: '## db.main.users (100 rows)\n| col | type |',
    };
    const prompt = await captureSystemPrompt(ctx);
    expect(prompt).toContain('<GeneratedContext>');
    expect(prompt).toContain('## db.main.users (100 rows)');
  });

  it('includes <GeneratedContext> via autoContextBySlot when catalogKey matches', async () => {
    const ctx: BenchmarkAnalystContext = {
      datasetKey: 'd1',
      catalogKey: 'agent-a',
      connections: [{ name: 'c', dialect: 'sqlite' }],
      autoContextBySlot: {
        'agent-a': '## slot-a context',
        'agent-b': '## slot-b context',
      },
    };
    const prompt = await captureSystemPrompt(ctx);
    expect(prompt).toContain('<GeneratedContext>');
    expect(prompt).toContain('## slot-a context');
    expect(prompt).not.toContain('## slot-b context');
  });

  it('prefers autoContextRendered over autoContextBySlot', async () => {
    const ctx: BenchmarkAnalystContext = {
      datasetKey: 'd1',
      catalogKey: 'agent-a',
      connections: [{ name: 'c', dialect: 'sqlite' }],
      autoContextRendered: '## direct rendered',
      autoContextBySlot: { 'agent-a': '## from slot map' },
    };
    const prompt = await captureSystemPrompt(ctx);
    expect(prompt).toContain('## direct rendered');
    expect(prompt).not.toContain('## from slot map');
  });

  it('omits <GeneratedContext> when no auto-context is available', async () => {
    const ctx: BenchmarkAnalystContext = {
      connections: [{ name: 'c', dialect: 'sqlite' }],
    };
    const prompt = await captureSystemPrompt(ctx);
    expect(prompt).not.toContain('<GeneratedContext>');
  });

  it('uses "default" slot when catalogKey is unset', async () => {
    const ctx: BenchmarkAnalystContext = {
      datasetKey: 'd1',
      connections: [{ name: 'c', dialect: 'sqlite' }],
      autoContextBySlot: { default: '## default slot context' },
    };
    const prompt = await captureSystemPrompt(ctx);
    expect(prompt).toContain('## default slot context');
  });
});
