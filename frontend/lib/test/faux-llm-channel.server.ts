/**
 * E2E faux LLM channel (Tests/QA/Evals Arch V2 — Phase 3).
 *
 * Lets an out-of-process Playwright test control the LLM the *real* server-side
 * orchestrator talks to, and inspect what it was sent. Two jobs:
 *   - install content-keyed faux responses (the switchboard matcher) on the
 *     chat-reachable agents' faux providers, and
 *   - record every request those providers received, for assertion.
 *
 * The browser-driver process can't touch this module's memory, so the
 * `/api/test/faux*` routes expose `configure` / `received` / `reset` over HTTP.
 * Because that crosses a JSON boundary, the wire format is a serializable
 * {@link FauxMatchDTO} (no functions) which `dtoToFauxMatch` rebuilds here.
 *
 * Gated entirely behind `E2E_MODE` at the route layer — never reachable in a
 * normal production build.
 */
import 'server-only';
import type { Context, StopReason } from '@/orchestrator/llm';
import {
  fauxMatcher,
  fauxAssistantMessage,
  fauxToolCall,
  lastUserText,
  lastToolName,
  type FauxMatch,
  type FauxResponseStep,
} from '@/orchestrator/llm/testing';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxRegistration as analystFaux } from '@/agents/analyst/analyst-agent';
import { fauxRegistration as benchmarkFaux } from '@/agents/benchmark-analyst/benchmark-analyst';
import { fauxRegistration as onboardingFaux } from '@/agents/onboarding/onboarding-agents';

// ─── Wire format (JSON-serializable; Playwright → /api/test/faux) ─────────────

/** A faux response described declaratively so it survives the HTTP boundary. */
export type FauxResponseDTO =
  | { kind: 'text'; text: string; stopReason?: StopReason }
  | { kind: 'toolCall'; name: string; arguments?: Record<string, unknown>; id?: string };

export interface FauxMatchDTO {
  userMessage: string;
  after?: string | string[];
  response: FauxResponseDTO;
  /** Hold the LLM reply for this long — lets e2e tests act mid-turn (e.g. sever the stream). */
  delayMs?: number;
}

function dtoToResponse(dto: FauxResponseDTO) {
  if (dto.kind === 'toolCall') {
    return fauxAssistantMessage([fauxToolCall(dto.name, dto.arguments ?? {}, dto.id ? { id: dto.id } : undefined)], {
      stopReason: 'toolUse',
    });
  }
  return fauxAssistantMessage(dto.text, { stopReason: dto.stopReason ?? 'stop' });
}

/** Rebuild a runtime {@link FauxMatch} from its serializable DTO. */
export function dtoToFauxMatch(dto: FauxMatchDTO): FauxMatch {
  return { userMessage: dto.userMessage, after: dto.after, response: dtoToResponse(dto.response) };
}

/** Per-userMessage delays, installed alongside the matcher by configureFauxFromDTO. */
// eslint-disable-next-line no-restricted-syntax -- test-only channel state (like `received` below); replaced wholesale on every configureFauxFromDTO call
let delayByUserMessage = new Map<string, number>();

// ─── Channel state ────────────────────────────────────────────────────────────

/** What an LLM call was sent — enough to key/assert on without dumping prompts. */
export interface RecordedLLMCall {
  userMessage: string;
  lastTool: string | null;
  messageCount: number;
}

interface FauxTarget {
  setResponses: (responses: FauxResponseStep[]) => void;
}

const MAX_CALLS = 64;

/**
 * Chat-reachable agents whose LLM calls the E2E channel controls. Append new
 * agents that the chat path can dispatch so their calls are faux'd + recorded.
 */
const DEFAULT_TARGETS: FauxTarget[] = [webAnalystFaux, analystFaux, benchmarkFaux, onboardingFaux];

let targets: FauxTarget[] = DEFAULT_TARGETS;
let received: RecordedLLMCall[] = [];

/** Override which faux providers the channel drives (test isolation). */
export function setFauxTargets(t: FauxTarget[]): void {
  targets = t;
}

/** Install matcher-based responses on every target; clears prior recordings. */
export function configureFaux(matches: FauxMatch[]): void {
  received = [];
  const match = fauxMatcher(matches); // validates keys once
  const recording = (async (ctx: Context) => {
    const userMessage = lastUserText(ctx);
    received.push({
      userMessage,
      lastTool: lastToolName(ctx) ?? null,
      messageCount: ctx.messages?.length ?? 0,
    });
    const delay = delayByUserMessage.get(userMessage);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return match(ctx);
  }) as unknown as FauxResponseStep;
  for (const t of targets) t.setResponses(Array.from({ length: MAX_CALLS }, () => recording));
}

/** Build matches from the serializable wire DTOs and install them. */
export function configureFauxFromDTO(dtos: FauxMatchDTO[]): void {
  delayByUserMessage = new Map(
    dtos.filter((d) => d.delayMs).map((d) => [d.userMessage, d.delayMs!]),
  );
  configureFaux(dtos.map(dtoToFauxMatch));
}

/** Every LLM call recorded since the last configure/reset. */
export function getReceived(): RecordedLLMCall[] {
  return received;
}

/** Clear recordings and drain all targets' faux queues. */
export function resetFaux(): void {
  received = [];
  for (const t of targets) t.setResponses([]);
}
