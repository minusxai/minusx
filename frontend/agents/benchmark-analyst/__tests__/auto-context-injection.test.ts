/**
 * Tests that BenchmarkAnalystAgent runs `buildAutoContext` before its
 * first LLM call and injects the returned markdown into the first user
 * message. Also verifies the cached result is used across multiple LLM
 * calls in the same run (buildAutoContext should be invoked only once).
 *
 * The actual AutoContext build is mocked here; correctness of the
 * underlying stages is covered in v2/auto-context/__tests__/.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fauxAssistantMessage, type Context, type TextContent } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { BenchmarkAnalystAgent, fauxRegistration } from '../benchmark-analyst';
import type { BenchmarkAnalystContext } from '../types';
import * as autoContextModule from '../v2/auto-context';

const REGISTRABLES = [BenchmarkAnalystAgent];

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'test_db', dialect: 'duckdb', description: 'test', config: { file_path: '/nonexistent/test.duckdb' } },
  ],
  contextDocs: 'docs',
  // Marks this as a benchmark run — production paths leave this unset and
  // skip the AutoContext pass entirely.
  datasetKey: 'test-dataset',
};

const AUTO_CONTEXT_MARKER = '<<AUTO_CONTEXT_MARKER_FOR_TEST>>';

describe('BenchmarkAnalystAgent auto-context injection', () => {
  let buildSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    buildSpy = vi
      .spyOn(autoContextModule, 'buildAutoContext')
      .mockResolvedValue(`## auto-context ${AUTO_CONTEXT_MARKER}`);
  });

  it('injects the AutoContext block into the first user message', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: done\nAnalysis: trivial.', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new BenchmarkAnalystAgent(orch, { userMessage: 'tell me about it' }, CTX);

    // Spy on callLLM to capture the first context it receives.
    let capturedFirstUserContent: unknown = null;
    const origCall = orch.callLLM.bind(orch);
    orch.callLLM = async (m, c: Context, id, opts) => {
      if (capturedFirstUserContent === null) {
        const userMsg = c.messages.find((msg) => msg.role === 'user');
        capturedFirstUserContent = userMsg?.content ?? null;
      }
      return origCall(m, c, id, opts);
    };

    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();

    expect(buildSpy).toHaveBeenCalled();
    expect(Array.isArray(capturedFirstUserContent)).toBe(true);
    const blocks = (capturedFirstUserContent as TextContent[]).map((b) => b.text);
    expect(blocks.some((t) => t.includes(AUTO_CONTEXT_MARKER))).toBe(true);
    expect(blocks.some((t) => t.includes('tell me about it'))).toBe(true);
    // AutoContext must precede the question.
    const autoIdx = blocks.findIndex((t) => t.includes(AUTO_CONTEXT_MARKER));
    const questionIdx = blocks.findIndex((t) => t.includes('tell me about it'));
    expect(autoIdx).toBeLessThan(questionIdx);
  });

  it('calls buildAutoContext exactly once per agent run (across multiple LLM iterations)', async () => {
    // Two scripted responses: first uses an unknown tool to force a 2nd iter;
    // we instead just send a text + stop to keep the test minimal.
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: x', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new BenchmarkAnalystAgent(orch, { userMessage: 'hi' }, CTX);

    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();

    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it('passes userMessage and llmContext (contextDocs + originalMessage) through to buildAutoContext', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new BenchmarkAnalystAgent(orch, { userMessage: 'find the thing' }, CTX);

    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();

    expect(buildSpy).toHaveBeenCalledTimes(1);
    const args = buildSpy.mock.calls[0];
    // Signature: (connections, llmContext, callLLM, opts)
    const llmContext = args[1] as { contextDocs?: string; originalMessage?: string };
    expect(llmContext.contextDocs).toBe('docs');
    expect(llmContext.originalMessage).toBe('find the thing');
    const opts = args[3] as { userMessage?: string };
    expect(opts.userMessage).toBe('find the thing');
  });
});
