/**
 * The conversation-size predicate — the single rule the server enforces and the client mirrors.
 *
 * Both layers call `conversationTooLong`, so this file is the whole contract for "is this
 * conversation over?". The two-prior-turns condition is the subtle half: a single enormous query
 * can push turn one over the limit, and refusing there strands the user (a fresh chat re-runs the
 * same query and lands at the same size), so the limit only bites once there is history to shed.
 */
import { describe, it, expect } from 'vitest';
import {
  conversationTooLong, TOKEN_LIMIT, MIN_PRIOR_USER_TURNS, CONVERSATION_TOO_LONG,
} from '@/lib/chat/conversation-limits';
// The engine's own ceiling, imported straight from the engine — `conversation-limits` stays
// client-safe by never re-exporting it (see the note there).
import { MAX_CONTEXT_TOKENS } from '@/orchestrator/types';

describe('conversationTooLong', () => {
  it('is false under the limit, however much history there is', () => {
    expect(conversationTooLong({ lastContextTokens: TOKEN_LIMIT - 1, priorUserTurns: 20 })).toBe(false);
  });

  it('is false exactly AT the limit — the limit is a ceiling to exceed, not to reach', () => {
    expect(conversationTooLong({ lastContextTokens: TOKEN_LIMIT, priorUserTurns: 20 })).toBe(false);
  });

  it('is true over the limit once there is history to shed', () => {
    expect(conversationTooLong({ lastContextTokens: TOKEN_LIMIT + 1, priorUserTurns: MIN_PRIOR_USER_TURNS })).toBe(true);
  });

  it('is false over the limit on a single-turn conversation — a fresh chat would re-run the same query', () => {
    expect(conversationTooLong({ lastContextTokens: TOKEN_LIMIT * 2, priorUserTurns: 1 })).toBe(false);
  });

  it('is false on a conversation that has never completed a turn (no stamp yet)', () => {
    expect(conversationTooLong({ lastContextTokens: undefined, priorUserTurns: 5 })).toBe(false);
    expect(conversationTooLong({ lastContextTokens: null, priorUserTurns: 5 })).toBe(false);
    expect(conversationTooLong({ lastContextTokens: 0, priorUserTurns: 5 })).toBe(false);
  });
});

describe('the two ceilings', () => {
  it('admits below what it aborts at — a turn starting just under the gate has room to run', () => {
    expect(TOKEN_LIMIT).toBeLessThan(MAX_CONTEXT_TOKENS);
  });

  it('exposes a typed refusal code, so the client never has to pattern-match our own message', () => {
    expect(CONVERSATION_TOO_LONG).toBe('conversation-too-long');
  });
});
