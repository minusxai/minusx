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

/** A queued faux response: a full assistant message or a factory producing one. */
export type FauxResponseStep = PiFauxResponseStep;

/** Register a faux LLM provider; returns a handle with `setResponses`/`getModel`/`unregister`. */
export const registerFauxProvider = piRegisterFauxProvider;

/** Build a faux assistant message (string, single block, or block array). */
export const fauxAssistantMessage = piFauxAssistantMessage;

/** Build a faux tool-call content block. */
export const fauxToolCall = piFauxToolCall;
