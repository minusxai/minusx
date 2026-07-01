/**
 * Client-only stash that preserves an in-flight Clarify answer across a reload (so a conversation
 * reopened before the resume turn committed the answer doesn't re-ask). See clarify-answer-stash.ts.
 */
import {
  stashClarifyAnswer, readClarifyAnswer, clearClarifyAnswer, clearStaleClarifyAnswers, reconstructClarifyProps,
  seedPendingClarifyInputs,
} from '@/lib/chat/clarify-answer-stash';
import type { DerivedPendingToolCall } from '@/lib/data/conversation-log';

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

beforeEach(() => { vi.stubGlobal('window', { localStorage: new MemStorage() }); });
afterEach(() => vi.unstubAllGlobals());

describe('clarify-answer-stash', () => {
  it('round-trips a stashed answer by (conversationId, toolCallId)', () => {
    stashClarifyAnswer(7, 'tc_1', { label: 'Exec summary' });
    expect(readClarifyAnswer(7, 'tc_1')).toEqual({ result: { label: 'Exec summary' } });
    // Different key → miss.
    expect(readClarifyAnswer(7, 'tc_other')).toBeNull();
    expect(readClarifyAnswer(8, 'tc_1')).toBeNull();
  });

  it('preserves every answer variant (multiSelect / figureItOut / other-text / cancel)', () => {
    const variants: unknown[] = [
      [{ label: 'A' }, { label: 'B' }],
      { label: 'Figure it out', figureItOut: true },
      { label: 'Other', other: true, text: 'custom' },
      { cancelled: true },
    ];
    variants.forEach((v, i) => {
      stashClarifyAnswer(1, `tc_${i}`, v);
      expect(readClarifyAnswer(1, `tc_${i}`)).toEqual({ result: v });
    });
  });

  it('clearClarifyAnswer removes a single entry', () => {
    stashClarifyAnswer(1, 'tc_1', 'x');
    clearClarifyAnswer(1, 'tc_1');
    expect(readClarifyAnswer(1, 'tc_1')).toBeNull();
  });

  it('clearStaleClarifyAnswers drops entries whose tool_call_id is no longer pending (committed)', () => {
    stashClarifyAnswer(1, 'still_pending', 'a');
    stashClarifyAnswer(1, 'committed', 'b');
    stashClarifyAnswer(2, 'other_conv', 'c'); // untouched — different conversation
    clearStaleClarifyAnswers(1, new Set(['still_pending']));
    expect(readClarifyAnswer(1, 'still_pending')).toEqual({ result: 'a' });
    expect(readClarifyAnswer(1, 'committed')).toBeNull();
    expect(readClarifyAnswer(2, 'other_conv')).toEqual({ result: 'c' });
  });

  it('expires entries past the TTL', () => {
    stashClarifyAnswer(1, 'tc_1', 'a');
    // Backdate the entry 25h.
    const key = 'mx:clarify-answer:1:tc_1';
    const raw = JSON.parse(window.localStorage.getItem(key)!);
    raw.ts = Date.now() - 25 * 60 * 60 * 1000;
    window.localStorage.setItem(key, JSON.stringify(raw));
    expect(readClarifyAnswer(1, 'tc_1')).toBeNull();
  });

  it('degrades to a no-op when localStorage is unavailable (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => stashClarifyAnswer(1, 'tc', 'x')).not.toThrow();
    expect(readClarifyAnswer(1, 'tc')).toBeNull();
  });

  it('reconstructClarifyProps rebuilds an answerable choice prompt from tool args', () => {
    const props = reconstructClarifyProps({
      question: 'Who is this for?',
      options: [{ label: 'Execs', description: 'crisp' }, { label: 'Team' }],
      multiSelect: true,
    });
    expect(props).toEqual({
      type: 'choice',
      title: 'Clarification needed',
      message: 'Who is this for?',
      options: [{ label: 'Execs', description: 'crisp' }, { label: 'Team' }],
      multiSelect: true,
      cancellable: true,
    });
  });

  it('reconstructClarifyProps is defensive about missing/oddly-typed args', () => {
    const props = reconstructClarifyProps({});
    expect(props.type).toBe('choice');
    expect(props.message).toBe('');
    expect(props.options).toEqual([]);
    expect(props.multiSelect).toBe(false);
  });
});

describe('seedPendingClarifyInputs — cold-load answerable prompt + replay', () => {
  let n = 0;
  const newId = () => `uid_${n++}`;
  beforeEach(() => { n = 0; });

  const clarify = (id: string): DerivedPendingToolCall => ({
    id, name: 'ClarifyFrontend', arguments: { question: 'Who for?', options: [{ label: 'Execs' }, { label: 'Team' }] },
  });

  it('seeds an ANSWERABLE userInputs entry (result undefined) for a fresh reopened Clarify', () => {
    const { pendingToolCalls, replays } = seedPendingClarifyInputs(9, [clarify('tc_1')], newId);
    expect(replays).toEqual([]); // nothing stashed → nothing to auto-replay
    const ui = pendingToolCalls[0].userInputs![0];
    expect(ui.result).toBeUndefined();            // undefined → the card renders the interactive prompt
    expect(ui.props.type).toBe('choice');
    expect(ui.props.options).toHaveLength(2);
  });

  it('seeds the stashed answer WITH a result and queues a replay (auto-resume, no re-ask)', () => {
    stashClarifyAnswer(9, 'tc_1', { label: 'Execs' });
    const { pendingToolCalls, replays } = seedPendingClarifyInputs(9, [clarify('tc_1')], newId);
    const ui = pendingToolCalls[0].userInputs![0];
    expect(ui.result).toEqual({ label: 'Execs' });                 // seeded → no answerable-prompt flash
    expect(replays).toEqual([{ toolCallId: 'tc_1', userInputId: ui.id, result: { label: 'Execs' } }]);
  });

  it('passes non-Clarify tools through untouched (no userInputs, no replay)', () => {
    const nav: DerivedPendingToolCall = { id: 'tc_nav', name: 'Navigate', arguments: {} };
    const { pendingToolCalls, replays } = seedPendingClarifyInputs(9, [nav], newId);
    expect(pendingToolCalls[0].userInputs).toBeUndefined();
    expect(replays).toEqual([]);
  });
});
