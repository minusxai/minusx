/**
 * Tests that BenchmarkAnalystAgent runs `buildAutoContext` before its
 * first LLM call and appends the returned markdown to its system prompt.
 *
 * The block lives in the system prompt (NOT the user message) so that
 * Anthropic's prompt-cache reuses it across rows of the same dataset
 * within the 5-min TTL — pi-ai marks the system prompt with
 * `cache_control` automatically. The user message stays question-only.
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

  it('appends the AutoContext block to the SYSTEM PROMPT (not the user message) for cross-row cache reuse', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: done\nAnalysis: trivial.', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new BenchmarkAnalystAgent(orch, { userMessage: 'tell me about it' }, CTX);

    let capturedSystem: string | null | undefined = null;
    let capturedUserContent: unknown = null;
    const origCall = orch.callLLM.bind(orch);
    orch.callLLM = async (m, c: Context, id, opts) => {
      if (capturedSystem === null) {
        capturedSystem = c.systemPrompt;
        const userMsg = c.messages.find((msg) => msg.role === 'user');
        capturedUserContent = userMsg?.content ?? null;
      }
      return origCall(m, c, id, opts);
    };

    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();

    expect(buildSpy).toHaveBeenCalled();

    // 1. AutoContext marker MUST appear in the system prompt.
    expect(capturedSystem).toContain(AUTO_CONTEXT_MARKER);

    // 2. User message MUST NOT carry the AutoContext block — it's just the question.
    const userBlocks = (capturedUserContent as TextContent[] | string);
    const userText = typeof userBlocks === 'string'
      ? userBlocks
      : userBlocks.map((b) => b.text).join('\n');
    expect(userText).toContain('tell me about it');
    expect(userText).not.toContain(AUTO_CONTEXT_MARKER);
  });

  it('calls buildAutoContext exactly once per agent run (across multiple LLM iterations)', async () => {
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

  it('keeps the system prompt clean (no AutoContext section) when buildAutoContext throws', async () => {
    buildSpy.mockRejectedValue(new Error('simulated build failure'));
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: x', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new BenchmarkAnalystAgent(orch, { userMessage: 'hi' }, CTX);

    let capturedSystem: string | null | undefined = null;
    const origCall = orch.callLLM.bind(orch);
    orch.callLLM = async (m, c: Context, id, opts) => {
      if (capturedSystem === null) capturedSystem = c.systemPrompt;
      return origCall(m, c, id, opts);
    };

    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();

    expect(capturedSystem).not.toContain(AUTO_CONTEXT_MARKER);
    // Doesn't appear at all — not even the "Auto-discovered context" header.
    expect(capturedSystem).not.toContain('Auto-discovered context');
  });
});
