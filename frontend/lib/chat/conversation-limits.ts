/**
 * How long a conversation may get before we stop it, and the one predicate that decides.
 *
 * The whole conversation is re-sent on every LLM call, so a turn's last call `usage.totalTokens`
 * IS the size of the entire conversation. That number is stamped onto the conversation row at turn
 * end (`meta.lastContextTokens`, see `setLastContextTokens`), which makes it the cheapest possible
 * signal: exact, already paid for, and durable across reloads.
 *
 * Two ceilings, deliberately different jobs:
 *
 *  - {@link TOKEN_LIMIT} is checked at TURN START, server-side, in `runConversationTurn` — the one
 *    runner behind the browser, Slack and scheduled jobs alike. A conversation over it is refused
 *    before a single token is spent.
 *  - {@link MAX_CONTEXT_TOKENS} (owned by the engine, re-exported here) is checked per LLM call in
 *    `MXAgent.llm()`. A turn admitted just under TOKEN_LIMIT can still grow across tool steps, so
 *    the turn-start gate alone bounds nothing WITHIN a turn.
 *
 * The two compose: the per-call abort leaves `lastContextTokens` stamped above TOKEN_LIMIT (the
 * stamp runs on the error path too), so the turn-start gate refuses everything after it.
 *
 * Both are flat numbers, NOT derived from the model's declared `contextWindow`. That was tried on
 * paper and is unsafe: `contextWindow` is a fallback default as often as it is real data — the
 * managed gateway's model handle declares 128k purely because `buildCustomModel` fills in
 * `?? 128_000`, while the gateway routes to something far larger. Deriving a limit from it would
 * lock out the DEFAULT path at ~115k. On a genuinely small-window model the provider's own refusal
 * arrives first and is already classified terminal (`error-retryability.ts`), which costs one
 * failed call and reaches the same "start a new chat" banner.
 */

/**
 * This module is CLIENT-SAFE and deliberately dependency-free: the browser imports it to render the
 * same predicate as an affordance, so the composer is replaced BEFORE the user writes a message the
 * server would refuse. That is also why the engine's ceiling is referenced here by name only and
 * never re-exported — `@/orchestrator/types` reaches `orchestrator/utils`, which imports node
 * `crypto`, and a value re-export would drag it into the client bundle.
 */

/** Conversation size, in tokens, above which a NEW turn is refused. Product decision. */
export const TOKEN_LIMIT = 200_000;

/**
 * Typed refusal code, carried on the error row's `details` and read by the client instead of
 * re-deriving intent from the message text. Message-matching is the fallback for PROVIDER errors,
 * whose text we don't control; it should never be how we recognize our own refusal.
 */
export const CONVERSATION_TOO_LONG = 'conversation-too-long';

/**
 * How many user turns must already exist before the limit can bite.
 *
 * A single enormous query can push one turn over the limit, and starting a fresh chat there is
 * useless — it re-runs the same query and lands at the same size. The limit is only actionable once
 * there is accumulated history to actually shed, so the 2nd turn of a huge conversation is always
 * allowed and the 3rd onward is refused.
 */
export const MIN_PRIOR_USER_TURNS = 2;

export interface ConversationSizeInput {
  /** `meta.lastContextTokens` — the last completed turn's final context size. Absent on a
   *  conversation that has never completed a turn. */
  lastContextTokens?: number | null;
  /** User turns already recorded (root invocations server-side; user messages client-side). */
  priorUserTurns: number;
}

/** Whether a NEW user turn must be refused. Server and client MUST agree, so both call this. */
export function conversationTooLong({ lastContextTokens, priorUserTurns }: ConversationSizeInput): boolean {
  if (!lastContextTokens || lastContextTokens <= TOKEN_LIMIT) return false;
  return priorUserTurns >= MIN_PRIOR_USER_TURNS;
}
