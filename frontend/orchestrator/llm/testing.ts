/**
 * LLM BOUNDARY — test support. Part of the pi-ai isolation boundary
 * (`orchestrator/llm/`); allowed to import `@mariozechner/pi-ai`.
 *
 * The faux provider lets tests inject deterministic LLM responses. It is also
 * used by production agent modules (each exports a `fauxRegistration` fallback
 * handle that tests drive via `setResponses`).
 */
import {
  registerFauxProvider as piRegisterFauxProvider,
  fauxAssistantMessage as piFauxAssistantMessage,
  fauxToolCall as piFauxToolCall,
} from '@mariozechner/pi-ai';
import type { FauxResponseStep as PiFauxResponseStep } from '@mariozechner/pi-ai';
import { fauxMatcher, type FauxMatch } from './faux-matcher';

/** A queued faux response: a full assistant message or a factory producing one. */
export type FauxResponseStep = PiFauxResponseStep;

/** Register a faux LLM provider; returns a handle with `setResponses`/`getModel`/`unregister`. */
export const registerFauxProvider = piRegisterFauxProvider;

/** Build a faux assistant message (string, single block, or block array). */
export const fauxAssistantMessage = piFauxAssistantMessage;

/** Build a faux tool-call content block. */
export const fauxToolCall = piFauxToolCall;

// ─── Content-keyed matcher bridge (Tests/QA/Evals Arch V2) ────────────────────
// Re-exported here so tests have a single import surface for faux setup, and so
// the pi-ai `FauxResponseStep` coercion stays inside this boundary module.

export {
  respondTo,
  fauxMatcher,
  lastUserText,
  lastToolName,
  type FauxMatch,
} from './faux-matcher';

/**
 * Register content-keyed faux responses (the switchboard matcher) on a faux
 * provider, replacing its sequential queue with a single matching factory.
 * The matcher keys on `(user_message [, after])` and fails loud on
 * duplicate / ambiguous / unmatched calls — see `faux-matcher.ts`.
 *
 * The underlying faux provider consumes one queue entry per LLM call, so the
 * (pure, stateless) matcher factory is enqueued `maxCalls` times — every copy
 * routes identically. Over-provisioning is harmless: surplus copies are never
 * consumed, and a genuinely unexpected call still throws from the matcher.
 */
export function setFauxMatches(
  registration: { setResponses: (responses: FauxResponseStep[]) => void },
  matches: FauxMatch[],
  { maxCalls = 64 }: { maxCalls?: number } = {},
): void {
  const factory = fauxMatcher(matches) as unknown as FauxResponseStep; // validates keys once
  registration.setResponses(Array.from({ length: maxCalls }, () => factory));
}
