/**
 * ════════════════════════════════════════════════════════════════════════════
 *  LLM BOUNDARY — the ONLY production module allowed to import `@mariozechner/pi-ai`.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * All pi-ai dependencies are isolated behind this directory (`orchestrator/llm/`);
 * an ESLint rule forbids importing `@mariozechner/pi-ai` anywhere else. The rest
 * of the codebase imports the OWNED types + wrapped runtime from here, and imports
 * typebox (`Type`, `TSchema`, `Static`) directly from `typebox`.
 *
 * Design:
 *  - DOMAIN types (messages, content blocks, tool calls, events, Context, Tool,
 *    Usage) are DEFINED here as our own — not re-exported from pi. They mirror the
 *    pi's shapes so the wrappers can cast across the seam; tsc over all consumers
 *    is the guard that they stay sufficient.
 *  - HANDLE types (`Model`, `Api`) are opaque pass-throughs — nothing outside this
 *    boundary inspects their fields, so they alias pi internally.
 *  - RUNTIME (`getModel`, `streamSimple`, `EventStream`) is wrapped, not re-exported.
 *
 * See `Migration.md` in this folder for the full rationale and export surface.
 */
import {
  getModel as piGetModel,
  streamSimple as piStreamSimple,
  EventStream as PiEventStream,
} from '@mariozechner/pi-ai';
import type {
  Api as PiApi,
  Model as PiModel,
  Context as PiContext,
  SimpleStreamOptions as PiSimpleStreamOptions,
  AssistantMessageDiagnostic,
} from '@mariozechner/pi-ai';
import type { TSchema } from 'typebox';

// ─── Opaque handle types (aliased to pi; never inspected outside this boundary) ──

/** Provider/api identifier. Opaque to consumers. */
export type Api = PiApi;
/** Opaque model handle. Obtain via `getModel()`; pass to `streamSimple()`. Do not inspect. */
export type Model<TApi extends Api = Api> = PiModel<TApi>;

// ─── Owned domain types (defined here; mirror pi's shapes across the seam) ───────

/**
 * A web-search citation attached to a text block (Anthropic-native shape, as
 * surfaced by the pi web-search patch). The frontend renders these as source
 * chips.
 */
export interface Citation {
  type: 'web_search_result_location';
  url: string;
  title?: string;
  cited_text?: string;
  encrypted_index?: string;
}

export interface TextContent {
  type: 'text';
  text: string;
  textSignature?: string;
  /** Web-search citations for this text span (present only when web search ran). */
  citations?: Citation[];
}

/** A single web search result inside a web_search_tool_result block. */
export interface WebSearchResult {
  type: 'web_search_result';
  url: string;
  title?: string;
  page_age?: string;
  encrypted_content?: string;
}

/** Server-side web-search results block (Anthropic-native shape). */
export interface WebSearchToolResultContent {
  type: 'web_search_tool_result';
  tool_use_id: string;
  content: WebSearchResult[];
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

/**
 * An image content block. Exactly one of `data` (base64) or `url` is set.
 * `url` is sent to Anthropic as a `source:{type:"url"}` (supported via the pi
 * patch); `data` as base64. `mimeType` is required for base64.
 */
export interface ImageContent {
  type: 'image';
  data?: string;
  url?: string;
  mimeType?: string;
}

export interface ToolCall {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

export interface UserMessage {
  role: 'user';
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: 'assistant';
  // Note: web_search_tool_result blocks (WebSearchToolResultContent) also appear
  // at runtime when web search ran (via the pi patch). They are read defensively
  // by the chat-translator rather than widening this union — keeping our
  // AssistantMessage structurally assignable to pi's across the faux test seam.
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  // Opaque provider diagnostics — kept structurally compatible with pi for the
  // faux test seam; not inspected by our code.
  diagnostics?: AssistantMessageDiagnostic[];
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ToolResultMessage<TDetails = unknown> {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

/** Event protocol for a streaming assistant response. Mirrors pi's union. */
export type AssistantMessageEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: 'done'; reason: Extract<StopReason, 'stop' | 'length' | 'toolUse'>; message: AssistantMessage }
  | { type: 'error'; reason: Extract<StopReason, 'aborted' | 'error'>; error: AssistantMessage };

/** Call-time options for a model stream. Loose by design — spread through to the provider. */
export interface StreamOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  apiKey?: string;
  /**
   * Enable Anthropic native web search (server-side `web_search` tool).
   * Honored by the pi web-search patch. `true` uses defaults; the object form
   * sets max searches and an approximate user location (city) — matching
   * Provider web-search options.
   */
  webSearch?: boolean | { maxUses?: number; userLocation?: { city?: string } };
  [key: string]: unknown;
}

// ─── Runtime (wrapped, not re-exported) ──────────────────────────────────────

/**
 * Generic async-event stream. Subclasses pi's implementation to keep behaviour
 * identical while owning the name (consumers never import pi's class).
 */
export class EventStream<T, R = T> extends PiEventStream<T, R> {}

/**
 * Resolve a provider model handle. Providers are called directly; LLM usage is
 * recorded out-of-band after each call (see `callLLM` → `AppEvents.LLM_CALL`),
 * so there is no request-path proxy.
 */
export function getModel<P extends string, M extends string>(provider: P, model: M): Model<Api> {
  return piGetModel(provider as never, model as never);
}

/** The pi-format request captured for one model call, for out-of-band logging. */
export interface LlmCallRequestCapture {
  request: Context;
}

// Header the orchestrator stamps with the per-call id (mirrors callLLM). The
// capture is keyed by that id — NOT by response-object identity, which isn't
// preserved across the streaming/persist path.
const CALL_ID_HEADER = 'X-MX-Request-Call-ID';
// Bounded so headless / benchmark runs (which never drain) can't grow unbounded;
// the Next server drains every entry per request so it normally stays tiny.
const MAX_LLM_CALL_CAPTURES = 256;
// eslint-disable-next-line no-restricted-syntax -- keyed by globally-unique per-call UUIDs (the call-id header), drained per request and size-bounded; not a cross-request cache
const llmCallRequests = new Map<string, LlmCallRequestCapture>();

/** Take (read-and-clear) the captured request for a call id, if any. */
export function takeLlmCallRequest(callId: string): LlmCallRequestCapture | undefined {
  const captured = llmCallRequests.get(callId);
  if (captured) llmCallRequests.delete(callId);
  return captured;
}

/** Stream a single model call. Returns a stream of our owned `AssistantMessageEvent`s. */
export function streamSimple(
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): EventStream<AssistantMessageEvent, AssistantMessage> {
  // Capture the pi-format request synchronously, keyed by the call id, so the
  // app can log it out-of-band. Side-effect-free for the caller.
  const callId = (options?.headers as Record<string, string> | undefined)?.[CALL_ID_HEADER];
  if (callId) {
    if (llmCallRequests.size >= MAX_LLM_CALL_CAPTURES) {
      const oldest = llmCallRequests.keys().next().value;
      if (oldest !== undefined) llmCallRequests.delete(oldest);
    }
    llmCallRequests.set(callId, { request: context });
  }
  return piStreamSimple(
    model,
    context as unknown as PiContext,
    options as PiSimpleStreamOptions | undefined,
  ) as unknown as EventStream<AssistantMessageEvent, AssistantMessage>;
}
