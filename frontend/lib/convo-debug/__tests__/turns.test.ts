import { describe, it, expect } from 'vitest';
import { buildTurnBars } from '@/lib/convo-debug/turns';
import { estimateTextTokens } from '@/lib/convo-debug/approx';
import { makeInput, user, assistant, toolResult, rootInvocation, logEntry, subInvocation, usage } from './fixtures';

describe('buildTurnBars — bar segmentation', () => {
  it('single user message, no assistant yet → one input bar with system prompt + tool defs', () => {
    const input = makeInput({
      systemPrompt: 'You are an analyst.',
      toolDefsChars: 200,
      messages: [user('hello')],
    });
    const bars = buildTurnBars(input);
    expect(bars).toHaveLength(1);
    expect(bars[0].type).toBe('input');
    expect(bars[0].callIndex).toBe(0);
    const types = bars[0].components.map((c) => c.type);
    expect(types).toContain('SystemPrompt');
    expect(types).toContain('ToolDefinitions');
    expect(types).toContain('UserText');
    const sys = bars[0].components.find((c) => c.type === 'SystemPrompt');
    expect(sys?.tokens).toBe(estimateTextTokens('You are an analyst.'));
    const defs = bars[0].components.find((c) => c.type === 'ToolDefinitions');
    expect(defs?.tokens).toBe(estimateTextTokens('x'.repeat(200)));
    expect(bars[0].tokens).toBe(bars[0].components.reduce((s, c) => s + c.tokens, 0));
  });

  it('simple Q→A → input bar (call 0) + assistant bar (call 0)', () => {
    const input = makeInput({
      messages: [user('hi'), assistant([{ type: 'text', text: 'hello!' }])],
    });
    const bars = buildTurnBars(input);
    expect(bars.map((b) => b.type)).toEqual(['input', 'assistant']);
    expect(bars.map((b) => b.callIndex)).toEqual([0, 0]);
  });

  it('tool-call loop → 4 bars; consecutive tool results merge into ONE bar with separate components', () => {
    const input = makeInput({
      messages: [
        user('run it'),
        assistant([
          { type: 'toolCall', id: 't1', name: 'SearchDBSchema', arguments: {} },
          { type: 'toolCall', id: 't2', name: 'ExecuteQuery', arguments: {} },
        ], { stopReason: 'toolUse' }),
        toolResult('t1', 'SearchDBSchema', 'schema...'),
        toolResult('t2', 'ExecuteQuery', 'rows...'),
        assistant([{ type: 'text', text: 'done' }]),
      ],
    });
    const bars = buildTurnBars(input);
    expect(bars.map((b) => b.type)).toEqual(['input', 'assistant', 'toolResults', 'assistant']);
    expect(bars.map((b) => b.callIndex)).toEqual([0, 0, 1, 1]);
    const trBar = bars[2];
    expect(trBar.components.filter((c) => c.type === 'ToolResult')).toHaveLength(2);
    expect(trBar.components.map((c) => c.toolName)).toEqual(['SearchDBSchema', 'ExecuteQuery']);
  });

  it('multi-user-turn conversation → second input bar gets the next call index', () => {
    const input = makeInput({
      messages: [
        user('first'),
        assistant([{ type: 'text', text: 'answer 1' }]),
        user('second'),
      ],
    });
    const bars = buildTurnBars(input);
    expect(bars.map((b) => b.type)).toEqual(['input', 'assistant', 'input']);
    // Trailing input bar belongs to the NEXT (not yet run) call.
    expect(bars.map((b) => b.callIndex)).toEqual([0, 0, 1]);
  });

  it('an interrupted/errored assistant message still gets a bar', () => {
    const input = makeInput({
      messages: [
        user('q'),
        assistant([{ type: 'text', text: 'partial' }], { stopReason: 'error', errorMessage: 'boom' }),
      ],
    });
    const bars = buildTurnBars(input);
    expect(bars).toHaveLength(2);
    expect(bars[1].type).toBe('assistant');
  });

  it('attaches sub-agent LLM calls as a SubAgentLLM component on the owning tool-result bar', () => {
    const rootAssistant = assistant(
      [{ type: 'toolCall', id: 'inv1', name: 'ReportAgent', arguments: {} }],
      { stopReason: 'toolUse' },
    );
    const subCall = assistant([{ type: 'text', text: 'sub work' }], { usage: usage({ output: 500 }) });
    const finalAssistant = assistant([{ type: 'text', text: 'done' }]);
    const input = makeInput({
      messages: [
        user('make a report'),
        rootAssistant,
        toolResult('inv1', 'ReportAgent', 'report created'),
        finalAssistant,
      ],
      log: [
        rootInvocation('root1'),
        logEntry(rootAssistant, 'root1'),
        subInvocation('inv1', 'ReportAgent', 'root1'),
        logEntry(subCall, 'inv1'),
        logEntry(toolResult('inv1', 'ReportAgent', 'report created'), 'root1'),
        logEntry(finalAssistant, 'root1'),
      ],
    });
    const bars = buildTurnBars(input);
    const trBar = bars.find((b) => b.type === 'toolResults');
    const sub = trBar?.components.find((c) => c.type === 'SubAgentLLM');
    expect(sub).toBeDefined();
    expect(sub?.toolName).toBe('ReportAgent');
    expect(sub?.toolCallId).toBe('inv1');
    expect(sub?.tokens).toBe(500);
  });

  it('labels bars with call numbers', () => {
    const input = makeInput({
      messages: [user('q'), assistant([{ type: 'text', text: 'a' }])],
    });
    const bars = buildTurnBars(input);
    expect(bars[0].label).toMatch(/user/i);
    expect(bars[1].label).toMatch(/assistant/i);
  });
});
