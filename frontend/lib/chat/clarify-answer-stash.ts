/**
 * Client-only persistence for an in-flight Clarify answer, so a conversation reopened BEFORE the
 * resume turn committed the answer to the durable log doesn't lose it (and re-ask). Best-effort:
 * localStorage may be unavailable (SSR, private mode) — every call degrades to a no-op.
 *
 * Scope is intentionally ClarifyFrontend ONLY. Other user-input tools (Navigate, PublishAll) have
 * side effects (router.push, opening the publish modal) that must not be replayed on reopen.
 *
 * The stash is a stopgap keyed by (conversationId, tool_call_id): once the server has the toolResult,
 * `derivePendingToolCalls` no longer lists that call, so `clearStaleClarifyAnswers` drops it. Entries
 * also self-expire via TTL. The server log stays the source of truth — replay only happens in the
 * exact window where the log lacks the toolResult, and a committed call is never re-listed as pending.
 */
import type { UserInputProps, UserInput } from '@/lib/tools/user-input-exception';
import type { DerivedPendingToolCall } from '@/lib/data/conversation-log';

const PREFIX = 'mx:clarify-answer:';
const TTL_MS = 24 * 60 * 60 * 1000; // 24h — abandoned stashes self-expire.

const storageKey = (conversationId: number, toolCallId: string) => `${PREFIX}${conversationId}:${toolCallId}`;

interface StashEntry {
  result: unknown;
  ts: number;
}

function ls(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Persist a user's Clarify answer against a possible reload. */
export function stashClarifyAnswer(conversationId: number, toolCallId: string, result: unknown): void {
  const store = ls();
  if (!store) return;
  try {
    store.setItem(storageKey(conversationId, toolCallId), JSON.stringify({ result, ts: Date.now() } satisfies StashEntry));
  } catch {
    // quota / serialization — best-effort, ignore.
  }
}

/** Read a stashed answer (dropping it if expired). Returns null when absent/expired/unavailable. */
export function readClarifyAnswer(conversationId: number, toolCallId: string): { result: unknown } | null {
  const store = ls();
  if (!store) return null;
  const key = storageKey(conversationId, toolCallId);
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as StashEntry;
    if (!entry || typeof entry.ts !== 'number' || Date.now() - entry.ts > TTL_MS) {
      store.removeItem(key);
      return null;
    }
    return { result: entry.result };
  } catch {
    return null;
  }
}

export function clearClarifyAnswer(conversationId: number, toolCallId: string): void {
  const store = ls();
  if (!store) return;
  try {
    store.removeItem(storageKey(conversationId, toolCallId));
  } catch {
    // ignore
  }
}

/**
 * Drop this conversation's stashes whose tool_call_id is no longer pending (the answer committed) or
 * that have expired. Called on each cold-load so committed/abandoned answers don't linger.
 */
export function clearStaleClarifyAnswers(conversationId: number, pendingToolCallIds: ReadonlySet<string>): void {
  const store = ls();
  if (!store) return;
  try {
    const convPrefix = `${PREFIX}${conversationId}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(convPrefix)) continue;
      const toolCallId = key.slice(convPrefix.length);
      let stale = !pendingToolCallIds.has(toolCallId);
      if (!stale) {
        try {
          const entry = JSON.parse(store.getItem(key) || '{}') as StashEntry;
          stale = typeof entry.ts !== 'number' || Date.now() - entry.ts > TTL_MS;
        } catch {
          stale = true;
        }
      }
      if (stale) toRemove.push(key);
    }
    toRemove.forEach((key) => store.removeItem(key));
  } catch {
    // ignore
  }
}

/**
 * Rebuild the choice-prompt props from a ClarifyFrontend tool call's args — mirrors the
 * UserInputException thrown by the ClarifyFrontend handler (lib/tools/tool-handlers.ts). Used on cold
 * load to seed a `userInputs[]` entry so a reopened Clarify is ANSWERABLE (without this the pending
 * tool has no userInputs and the card renders a dead "Waiting for response…" state).
 */
export function reconstructClarifyProps(args: Record<string, unknown>): UserInputProps {
  const rawOptions = Array.isArray(args.options) ? (args.options as Array<Record<string, unknown>>) : [];
  return {
    type: 'choice',
    title: 'Clarification needed',
    message: typeof args.question === 'string' ? args.question : '',
    options: rawOptions.map((o) => ({
      label: typeof o.label === 'string' ? o.label : '',
      ...(typeof o.description === 'string' ? { description: o.description } : {}),
    })),
    multiSelect: args.multiSelect === true,
    cancellable: true,
  };
}

export interface SeededPendingToolCall {
  toolCall: { id: string; type: 'function'; function: { name: string; arguments: Record<string, unknown> } };
  result: undefined;
  userInputs?: UserInput[];
}

export interface SeedPendingResult {
  pendingToolCalls: SeededPendingToolCall[];
  /** Stashed answers to replay (dispatch setUserInputResult) after loadConversation, to auto-resume. */
  replays: Array<{ toolCallId: string; userInputId: string; result: unknown }>;
}

/**
 * Build the cold-load `pending_tool_calls` for a resumable conversation. Each ClarifyFrontend pending
 * tool gets a seeded `userInputs[0]` reconstructed from its args so the reopened prompt is ANSWERABLE
 * (a bare pending tool has no userInputs → the card renders a dead "Waiting for response…" state). If
 * the user already answered before a reload (stashed client-side), the seed carries that result and is
 * queued in `replays` so the caller can auto-resume instead of re-asking. Non-Clarify tools pass
 * through untouched. Pure (aside from the localStorage read) — `newId` is injected for determinism.
 */
export function seedPendingClarifyInputs(
  conversationId: number,
  pending: ReadonlyArray<DerivedPendingToolCall>,
  newId: () => string,
): SeedPendingResult {
  const replays: SeedPendingResult['replays'] = [];
  const pendingToolCalls = pending.map((p): SeededPendingToolCall => {
    const toolCall = { id: p.id, type: 'function' as const, function: { name: p.name, arguments: p.arguments } };
    if (p.name !== 'ClarifyFrontend') return { toolCall, result: undefined };
    const userInputId = newId();
    const saved = readClarifyAnswer(conversationId, p.id);
    if (saved) replays.push({ toolCallId: p.id, userInputId, result: saved.result });
    return {
      toolCall,
      result: undefined,
      userInputs: [{
        id: userInputId,
        props: reconstructClarifyProps(p.arguments),
        result: saved ? saved.result : undefined,
        ...(saved ? { providedAt: new Date().toISOString() } : {}),
      }],
    };
  });
  return { pendingToolCalls, replays };
}
