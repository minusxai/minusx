/**
 * Tests for the AutoContext helpers in index.ts:
 *   - `extractAutoContextPayload` parses a wrapped agent toolResult
 *   - `extractAutoContextPayloadFromLog` walks the orchestrator log
 *   - `buildAutoContextSynthAssistant` / `buildAutoContextCacheHitWrapper`
 *      produce the right shape
 *   - `isAutoContextDispatchMessage` / `spliceAutoContextDispatchPair`
 *      identify and remove the dispatch pair
 *   - `AutoContextAgent` registered + dispatched end-to-end produces a
 *     wrapper carrying the tagged payload (integration sanity check)
 *
 * The full BenchmarkAnalystAgent flow (dispatch + cache + system-prompt
 * injection) is covered in `agents/benchmark-analyst/__tests__/`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fauxAssistantMessage, registerFauxProvider, type Message, type ToolResultMessage, type AssistantMessage } from '@mariozechner/pi-ai';
import {
  AutoContextAgent,
  type AutoContextPayload,
  buildAutoContextCacheHitWrapper,
  buildAutoContextSynthAssistant,
  clearAutoContextCache,
  extractAutoContextPayload,
  extractAutoContextPayloadFromLog,
  isAutoContextDispatchMessage,
  spliceAutoContextDispatchPair,
} from '..';

const fauxReg = registerFauxProvider({
  api: 'faux-auto-context-helpers',
  provider: 'faux-auto-context-helpers',
  models: [{ id: 'stub-auto-context-helpers' }],
});

const VALID_PAYLOAD: AutoContextPayload = {
  tables: [{
    connection: 'db',
    schema: 'public',
    table: 'users',
    tableNote: 'core user table',
    columns: [{ name: 'id', note: 'pk' }],
    joins: [],
  }],
  examples: [],
};

beforeEach(() => {
  clearAutoContextCache();
  fauxReg.setResponses([]);
});

describe('buildAutoContextSynthAssistant', () => {
  it('produces an assistant message with a single AutoContextAgent toolCall', () => {
    const m = buildAutoContextSynthAssistant('abc-id', '<catalog>...</catalog>');
    expect(m.role).toBe('assistant');
    expect(m.content).toHaveLength(1);
    const tc = m.content[0];
    expect(tc.type).toBe('toolCall');
    if (tc.type === 'toolCall') {
      expect(tc.id).toBe('abc-id');
      expect(tc.name).toBe(AutoContextAgent.schema.name);
      expect(tc.arguments).toEqual({ userMessage: '<catalog>...</catalog>' });
    }
    expect(m.stopReason).toBe('toolUse');
  });
});

describe('buildAutoContextCacheHitWrapper', () => {
  it('produces a wrapped toolResult carrying the tagged payload under details.assistantMessage', () => {
    const w = buildAutoContextCacheHitWrapper('abc-id', VALID_PAYLOAD);
    expect(w.role).toBe('toolResult');
    expect(w.toolCallId).toBe('abc-id');
    expect(w.toolName).toBe(AutoContextAgent.schema.name);
    expect(w.isError).toBe(false);
    const details = w.details as { type: string; assistantMessage: AssistantMessage };
    expect(details.type).toBe('mx_agent');
    const text = (details.assistantMessage.content[0] as { text: string }).text;
    expect(text).toContain('<AutoContext>');
    expect(text).toContain('"tables"');
    expect(text).toContain('users');
  });
});

describe('extractAutoContextPayload', () => {
  it('returns the parsed payload from a valid wrapper', () => {
    const w = buildAutoContextCacheHitWrapper('id', VALID_PAYLOAD);
    const r = extractAutoContextPayload(w);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.tables[0].table).toBe('users');
  });

  it('returns reason=no-wrapper when given undefined', () => {
    const r = extractAutoContextPayload(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-wrapper');
  });

  it('returns reason=no-tag when the wrapper assistantMessage lacks the AutoContext tag', () => {
    const w: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'id',
      toolName: AutoContextAgent.schema.name,
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      details: {
        type: 'mx_agent',
        assistantMessage: fauxAssistantMessage('I refuse.', { stopReason: 'stop' }),
      },
      timestamp: Date.now(),
    };
    const r = extractAutoContextPayload(w);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('no-tag');
      expect(r.finalText).toContain('I refuse');
    }
  });

  it('returns reason=bad-json when tag is present but JSON is malformed', () => {
    const w: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'id',
      toolName: AutoContextAgent.schema.name,
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      details: {
        type: 'mx_agent',
        assistantMessage: fauxAssistantMessage(
          '<AutoContext>{bad json}</AutoContext>',
          { stopReason: 'stop' },
        ),
      },
      timestamp: Date.now(),
    };
    const r = extractAutoContextPayload(w);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-json');
  });
});

describe('extractAutoContextPayloadFromLog', () => {
  it('finds the wrapped toolResult by agent id and parses the payload', () => {
    const w = buildAutoContextCacheHitWrapper('my-agent-id', VALID_PAYLOAD);
    // pretend it's been pushed into a log
    const log = [{ ...w, parent_id: 'parent' }];
    const r = extractAutoContextPayloadFromLog(log as never, 'my-agent-id');
    expect(r.ok).toBe(true);
  });

  it('returns no-wrapper when nothing matches', () => {
    const r = extractAutoContextPayloadFromLog([], 'nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-wrapper');
  });
});

describe('autoContextStore race-locking', () => {
  it('synchronous get/set lets later .get() read the in-flight Promise from earlier .set()', async () => {
    // The race-locking guarantee: as long as `.get()` and `.set()` are
    // synchronous (no awaits between them), two parallel callers can't
    // both miss. `ensureAutoContext` relies on this by inserting the
    // in-flight Promise BEFORE any await on the miss path.
    const { autoContextStore } = await import('..');
    autoContextStore.clear();
    const cacheKey = 'd:s:full';

    // Caller A: miss → insert in-flight Promise.
    const pA = autoContextStore.get(cacheKey);
    expect(pA).toBeUndefined();
    const inFlight = Promise.resolve(VALID_PAYLOAD);
    autoContextStore.set(cacheKey, inFlight);

    // Caller B (later, synchronously or after an await): get → finds A's insert.
    const pB = autoContextStore.get(cacheKey);
    expect(pB).toBe(inFlight);

    // Both callers awaiting → same payload, single underlying Promise.
    const [valA, valB] = await Promise.all([inFlight, pB!]);
    expect(valA).toBe(VALID_PAYLOAD);
    expect(valB).toBe(VALID_PAYLOAD);
  });
});

describe('isAutoContextDispatchMessage / spliceAutoContextDispatchPair', () => {
  it('identifies both halves of the dispatch pair by id', () => {
    const synth = buildAutoContextSynthAssistant('id-1', 'catalog');
    const wrapper = buildAutoContextCacheHitWrapper('id-1', VALID_PAYLOAD);
    expect(isAutoContextDispatchMessage(synth, 'id-1')).toBe(true);
    expect(isAutoContextDispatchMessage(wrapper, 'id-1')).toBe(true);
    // Wrong id → not a match.
    expect(isAutoContextDispatchMessage(synth, 'id-2')).toBe(false);
  });

  it('splices both halves out of a message array, leaving other entries', () => {
    const other: AssistantMessage = fauxAssistantMessage('hello', { stopReason: 'stop' });
    const arr: Message[] = [
      buildAutoContextSynthAssistant('to-remove', 'c'),
      other,
      buildAutoContextCacheHitWrapper('to-remove', VALID_PAYLOAD),
    ];
    spliceAutoContextDispatchPair(arr, 'to-remove');
    expect(arr).toEqual([other]);
  });
});
