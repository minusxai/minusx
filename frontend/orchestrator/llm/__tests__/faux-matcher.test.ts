/**
 * Phase 1 — pure faux matcher unit tests (Tests/QA/Evals Arch V2).
 *
 * The matcher is a pure function over a conversation `Context`. It keys faux LLM
 * responses on (user_message [, after]) and must NEVER silently mis-route:
 *   - duplicate keys → rejected at registration
 *   - ambiguous runtime match (>1) → throws
 *   - no match → throws UnexpectedFauxLLMError
 *
 * These tests run in the `orchestrator` vitest project (node env, pure logic).
 */
import { describe, it, expect } from 'vitest';
import type { Context, Message } from '@/orchestrator/llm';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import {
  lastUserText,
  lastToolName,
  matchesMessage,
  matchesAfter,
  findResponse,
  respondTo,
  assertNoDuplicateKeys,
  fauxMatcher,
  UnexpectedFauxLLMError,
  AmbiguousFauxLLMError,
} from '@/orchestrator/llm/faux-matcher';

// ─── tiny context builders (only the fields the matcher reads) ────────────────

const userStr = (text: string): Message =>
  ({ role: 'user', content: text, timestamp: 0 } as Message);

const userBlocks = (...texts: string[]): Message =>
  ({ role: 'user', content: texts.map((t) => ({ type: 'text', text: t })), timestamp: 0 } as Message);

const assistantToolCall = (name: string): Message =>
  ({ role: 'assistant', content: [{ type: 'toolCall', id: 'tc', name, arguments: {} }], stopReason: 'toolUse', timestamp: 0 } as unknown as Message);

const toolResult = (toolName: string): Message =>
  ({ role: 'toolResult', toolCallId: 'tc', toolName, content: [], isError: false, timestamp: 0 } as Message);

const ctx = (...messages: Message[]): Context => ({ messages });

const reply = (text: string) => fauxAssistantMessage(text, { stopReason: 'stop' });

// ─── lastUserText ─────────────────────────────────────────────────────────────

describe('lastUserText', () => {
  it('returns string content directly', () => {
    expect(lastUserText(ctx(userStr('Describe this')))).toBe('Describe this');
  });

  it('joins text blocks (app-state-wrapped user turn)', () => {
    const t = lastUserText(ctx(userBlocks('<app-state>{...}</app-state>', 'Describe this')));
    expect(t).toContain('Describe this'); // human text survives wrapping
  });

  it('returns the ORIGINAL user message across a tool loop (not the toolResult)', () => {
    const c = ctx(userStr('Describe this'), assistantToolCall('ExecuteQuery'), toolResult('ExecuteQuery'));
    expect(lastUserText(c)).toBe('Describe this');
  });

  it('returns the most recent user message across turns', () => {
    const c = ctx(userStr('first'), assistantToolCall('X'), toolResult('X'), userStr('second'));
    expect(lastUserText(c)).toBe('second');
  });

  it('empty context → empty string', () => {
    expect(lastUserText(ctx())).toBe('');
  });
});

// ─── lastToolName ─────────────────────────────────────────────────────────────

describe('lastToolName', () => {
  it('turn start (only user message) → undefined', () => {
    expect(lastToolName(ctx(userStr('Describe this')))).toBeUndefined();
  });

  it('after a tool result → that tool name', () => {
    const c = ctx(userStr('Describe this'), assistantToolCall('ExecuteQuery'), toolResult('ExecuteQuery'));
    expect(lastToolName(c)).toBe('ExecuteQuery');
  });

  it('stops at the current turn boundary (ignores prior-turn tools)', () => {
    const c = ctx(userStr('first'), toolResult('OldTool'), userStr('second'));
    expect(lastToolName(c)).toBeUndefined(); // no tool ran since "second"
  });

  it('returns the most recent tool of the current turn', () => {
    const c = ctx(userStr('q'), toolResult('SearchFiles'), assistantToolCall('ExecuteQuery'), toolResult('ExecuteQuery'));
    expect(lastToolName(c)).toBe('ExecuteQuery');
  });
});

// ─── matchesMessage ───────────────────────────────────────────────────────────

describe('matchesMessage', () => {
  it('substring match (registered text inside wrapped actual)', () => {
    expect(matchesMessage('Describe this', '<ctx/>\nDescribe this')).toBe(true);
  });
  it('non-match', () => {
    expect(matchesMessage('Describe this', 'Make it a bar chart')).toBe(false);
  });
});

// ─── matchesAfter ─────────────────────────────────────────────────────────────

describe('matchesAfter', () => {
  it('omitted after matches only first call of turn (no tool ran)', () => {
    expect(matchesAfter(undefined, undefined)).toBe(true);
    expect(matchesAfter(undefined, 'ExecuteQuery')).toBe(false);
  });
  it('exact string', () => {
    expect(matchesAfter('ExecuteQuery', 'ExecuteQuery')).toBe(true);
    expect(matchesAfter('ExecuteQuery', 'Clarify')).toBe(false);
    expect(matchesAfter('ExecuteQuery', undefined)).toBe(false);
  });
  it('array one-of', () => {
    expect(matchesAfter(['ExecuteQuery', 'Clarify'], 'Clarify')).toBe(true);
    expect(matchesAfter(['ExecuteQuery', 'Clarify'], 'ReadFiles')).toBe(false);
  });
});

// ─── findResponse ─────────────────────────────────────────────────────────────

describe('findResponse', () => {
  it('single-pass turn: matches the message-only registration', () => {
    const reg = [respondTo('Describe this', reply('hi'))];
    expect(findResponse(reg, ctx(userStr('Describe this')))).toBe(reg[0]);
  });

  it('tool loop: first call → tool registration, second call → after registration', () => {
    const toolReg = respondTo('Describe this', fauxAssistantMessage([], { stopReason: 'toolUse' }));
    const doneReg = respondTo('Describe this', reply('done'), { after: 'ExecuteQuery' });
    const reg = [toolReg, doneReg];

    expect(findResponse(reg, ctx(userStr('Describe this')))).toBe(toolReg);
    expect(
      findResponse(reg, ctx(userStr('Describe this'), assistantToolCall('ExecuteQuery'), toolResult('ExecuteQuery'))),
    ).toBe(doneReg);
  });

  it('no match → undefined', () => {
    const reg = [respondTo('Describe this', reply('hi'))];
    expect(findResponse(reg, ctx(userStr('Something else')))).toBeUndefined();
  });

  it('ambiguous match (two registrations match same call) → throws', () => {
    // Both omit `after`, both substrings of the actual → both match the first call.
    const reg = [respondTo('Describe', reply('a')), respondTo('this', reply('b'))];
    expect(() => findResponse(reg, ctx(userStr('Describe this')))).toThrow(AmbiguousFauxLLMError);
  });
});

// ─── assertNoDuplicateKeys ────────────────────────────────────────────────────

describe('assertNoDuplicateKeys', () => {
  it('rejects identical (message, after) keys', () => {
    const reg = [
      respondTo('Describe this', reply('a'), { after: 'ExecuteQuery' }),
      respondTo('Describe this', reply('b'), { after: 'ExecuteQuery' }),
    ];
    expect(() => assertNoDuplicateKeys(reg)).toThrow();
  });
  it('allows same message with different after', () => {
    const reg = [
      respondTo('Describe this', reply('a')),
      respondTo('Describe this', reply('b'), { after: 'ExecuteQuery' }),
    ];
    expect(() => assertNoDuplicateKeys(reg)).not.toThrow();
  });
  it('treats array after as a set (order-independent duplicate)', () => {
    const reg = [
      respondTo('m', reply('a'), { after: ['ExecuteQuery', 'Clarify'] }),
      respondTo('m', reply('b'), { after: ['Clarify', 'ExecuteQuery'] }),
    ];
    expect(() => assertNoDuplicateKeys(reg)).toThrow();
  });
});

// ─── fauxMatcher factory (what gets passed to setResponses) ───────────────────

describe('fauxMatcher', () => {
  it('returns the matched response for a call', async () => {
    const factory = fauxMatcher([respondTo('Describe this', reply('charted'))]);
    const msg = await factory(ctx(userStr('Describe this')), undefined, { callCount: 0 }, {} as never);
    expect(msg.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'charted' })]));
  });

  it('throws UnexpectedFauxLLMError on an unregistered call (naming the message)', async () => {
    const factory = fauxMatcher([respondTo('Describe this', reply('x'))]);
    const err = await factory(ctx(userStr('totally unexpected')), undefined, { callCount: 0 }, {} as never).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnexpectedFauxLLMError);
    expect((err as Error).message).toMatch(/totally unexpected/);
  });

  it('rejects duplicate keys at construction', () => {
    expect(() =>
      fauxMatcher([respondTo('m', reply('a')), respondTo('m', reply('b'))]),
    ).toThrow();
  });

  it('supports a function response (receives the context)', async () => {
    const factory = fauxMatcher([respondTo('echo', (c) => reply(lastUserText(c).toUpperCase()))]);
    const msg = await factory(ctx(userStr('echo')), undefined, { callCount: 0 }, {} as never);
    expect(msg.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'ECHO' })]));
  });
});
