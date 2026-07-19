import { describe, it, expect } from 'vitest';
import type { ToolCall } from '@/orchestrator/llm';
import { extractActualCalls, requestJsonToInput } from '@/lib/convo-debug/actual';
import { makeInput, user, assistant, toolResult, rootInvocation, logEntry, subInvocation, usage, RATES } from './fixtures';

describe('extractActualCalls', () => {
  it('extracts root calls in order, picking the call id off the message or its first toolCall block', () => {
    // Call id stamped on the first toolCall block (the engine's behavior for toolUse stops)…
    const tc: ToolCall & { _lllmCallId?: string } = { type: 'toolCall', id: 't1', name: 'ExecuteQuery', arguments: {}, _lllmCallId: 'call-1' };
    const a1 = assistant([tc], { stopReason: 'toolUse' });
    // …and on the message itself for text-only stops.
    const a2 = Object.assign(assistant([{ type: 'text', text: 'done' }]), { _lllmCallId: 'call-2' });
    const log = [
      rootInvocation('r1'),
      logEntry(a1, 'r1'),
      logEntry(toolResult('t1', 'ExecuteQuery', 'rows'), 'r1'),
      logEntry(a2, 'r1'),
    ];
    const calls = extractActualCalls(log);
    expect(calls.map((c) => c.callId)).toEqual(['call-1', 'call-2']);
    expect(calls.every((c) => !c.isSubAgent)).toBe(true);
  });

  it('flags sub-agent calls and resolves the root-level tool they ran under', () => {
    const rootCall = assistant([{ type: 'toolCall', id: 'inv1', name: 'ReportAgent', arguments: {} }], { stopReason: 'toolUse' });
    const subCall = assistant([{ type: 'text', text: 'sub' }], { usage: usage({ output: 9 }) });
    const log = [
      rootInvocation('r1'),
      logEntry(rootCall, 'r1'),
      subInvocation('inv1', 'ReportAgent', 'r1'),
      logEntry(subCall, 'inv1'),
      logEntry(toolResult('inv1', 'ReportAgent', 'ok'), 'r1'),
    ];
    const calls = extractActualCalls(log);
    expect(calls).toHaveLength(2);
    expect(calls[0].isSubAgent).toBe(false);
    expect(calls[1].isSubAgent).toBe(true);
    expect(calls[1].rootToolName).toBe('ReportAgent');
  });

  it('handles multiple root invocations (one per turn)', () => {
    const a1 = assistant([{ type: 'text', text: 'one' }]);
    const a2 = assistant([{ type: 'text', text: 'two' }]);
    const log = [
      rootInvocation('r1'),
      logEntry(a1, 'r1'),
      rootInvocation('r2'),
      logEntry(a2, 'r2'),
    ];
    const calls = extractActualCalls(log);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => !c.isSubAgent)).toBe(true);
  });

  it('returns empty for a log with no assistant entries', () => {
    expect(extractActualCalls([rootInvocation('r1')])).toEqual([]);
  });
});

describe('requestJsonToInput', () => {
  it('parses a recorded pi-format request into a ConvoDebugInput', () => {
    const request = {
      systemPrompt: 'You are an analyst.',
      messages: [user('hello'), assistant([{ type: 'text', text: 'hi' }])],
      tools: [{ name: 'ExecuteQuery', description: 'Run SQL', parameters: { type: 'object' } }],
    };
    const log = [rootInvocation('r1')];
    const input = requestJsonToInput(JSON.stringify(request), log, RATES);
    expect(input.systemPrompt).toBe('You are an analyst.');
    expect(input.messages).toHaveLength(2);
    expect(input.toolDefsChars).toBe(JSON.stringify(request.tools).length);
    expect(input.log).toBe(log);
    expect(input.rates).toBe(RATES);
  });

  it('throws on malformed request json', () => {
    expect(() => requestJsonToInput('not json', [], {})).toThrow();
  });

  it('tolerates a missing systemPrompt and tools', () => {
    const input = requestJsonToInput(JSON.stringify({ messages: [] }), [], {});
    expect(input.systemPrompt).toBe('');
    expect(input.toolDefsChars).toBe(0);
    expect(input.messages).toEqual([]);
  });
});

describe('makeInput fixture sanity', () => {
  it('builds a well-formed input', () => {
    expect(makeInput().messages).toEqual([]);
  });
});
