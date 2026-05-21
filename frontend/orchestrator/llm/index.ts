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
 *    Usage) are DEFINED here as our own — not re-exported from pi. They mirror
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
import { MX_API_BASE_URL, MX_API_KEY } from '@/lib/config';

// ─── Opaque handle types (aliased to pi; never inspected outside this boundary) ──

/** Provider/api identifier. Opaque to consumers. */
export type Api = PiApi;
/** Opaque model handle. Obtain via `getModel()`; pass to `streamSimple()`. Do not inspect. */
export type Model<TApi extends Api = Api> = PiModel<TApi>;

// ─── Owned domain types (defined here; mirror pi's shapes across the seam) ───────

export interface TextContent {
  type: 'text';
  text: string;
  textSignature?: string;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
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
  [key: string]: unknown;
}

// ─── Runtime (wrapped, not re-exported) ──────────────────────────────────────

/**
 * Generic async-event stream. Subclasses pi's implementation to keep behaviour
 * identical while owning the name (consumers never import pi's class).
 */
export class EventStream<T, R = T> extends PiEventStream<T, R> {}

/**
 * Resolve a provider model handle. When the MX proxy is configured, rewrite the
 * base URL + headers so the call is routed (and cost-tracked) through it; OSS
 * deployments (no proxy) call the provider directly.
 */
export function getModel<P extends string, M extends string>(provider: P, model: M): Model<Api> {
  const base = piGetModel(provider as never, model as never);
  if (!MX_API_BASE_URL) return base;
  const originalBaseUrl = (base as unknown as { baseUrl?: string }).baseUrl;
  return {
    ...base,
    baseUrl: `${MX_API_BASE_URL}/proxy`,
    headers: {
      ...((base as unknown as { headers?: Record<string, string> }).headers ?? {}),
      'mx-api-key': MX_API_KEY,
      ...(originalBaseUrl ? { 'x-original-base-url': originalBaseUrl } : {}),
    },
  } as typeof base;
}

/** Stream a single model call. Returns a stream of our owned `AssistantMessageEvent`s. */
export function streamSimple(
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): EventStream<AssistantMessageEvent, AssistantMessage> {
  return piStreamSimple(
    model,
    context as unknown as PiContext,
    options as PiSimpleStreamOptions | undefined,
  ) as unknown as EventStream<AssistantMessageEvent, AssistantMessage>;
}
