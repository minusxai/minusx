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
  getModels as piGetModels,
  getProviders as piGetProviders,
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
  const resolved = piGetModel(provider as never, model as never);
  if (!resolved) {
    throw new Error(
      `Unknown LLM provider/model: "${provider}"/"${model}" — not in the model registry. ` +
      `For a local or custom OpenAI-compatible endpoint (Ollama, vLLM, …), use ` +
      `"customModel" in the agent model config instead of "provider"/"model".`,
    );
  }
  return resolved;
}

/** Registry model summary — safe, plain fields for pickers/UI (no handle internals). */
export interface RegistryModelInfo {
  id: string;
  name: string;
  reasoning: boolean;
  input: ('text' | 'image')[];
  contextWindow: number;
}

/** Provider slugs known to the model registry (for provider pickers). */
export function listProviders(): string[] {
  return piGetProviders();
}

/** Models a registry provider serves, as plain picker-friendly summaries. */
export function listModels(provider: string): RegistryModelInfo[] {
  let models: unknown[];
  try {
    models = piGetModels(provider as never) as unknown[];
  } catch {
    return [];
  }
  return (models ?? []).map((m) => {
    const model = m as { id: string; name?: string; reasoning?: boolean; input?: ('text' | 'image')[]; contextWindow?: number };
    return {
      id: model.id,
      name: model.name ?? model.id,
      reasoning: model.reasoning ?? false,
      input: model.input ?? ['text'],
      contextWindow: model.contextWindow ?? 0,
    };
  });
}

/**
 * Spec for a model served from a custom endpoint that is NOT in the provider
 * registry — a local Ollama/vLLM/llama.cpp server or any OpenAI-compatible
 * gateway. Only `baseUrl` and `id` are required; everything else has
 * conservative defaults. Provider-specific quirks are auto-detected from the
 * URL and can be overridden via `compat`.
 */
export interface CustomModelSpec {
  /** Endpoint base URL, e.g. `http://localhost:11434/v1`. */
  baseUrl: string;
  /** Model id the endpoint expects, e.g. `qwen3:32b`. */
  id: string;
  /** Wire API. Default: `openai-completions`. */
  api?: string;
  /** Display name. Default: the id. */
  name?: string;
  /** Provider slug (also used for env API-key lookup). Default: `custom`. */
  provider?: string;
  /** Env var name holding the endpoint's API key, injected at call time. */
  apiKeyEnv?: string;
  /** Whether the model emits reasoning/thinking. Default: false. */
  reasoning?: boolean;
  /** Supported input modalities. Default: `['text']`. */
  input?: ('text' | 'image')[];
  /** Context window in tokens. Default: 128000. */
  contextWindow?: number;
  /** Max output tokens per call. Default: 8192. */
  maxTokens?: number;
  /** Extra HTTP headers merged into requests. */
  headers?: Record<string, string>;
  /** OpenAI-compat overrides (e.g. `maxTokensField`, `thinkingFormat`). */
  compat?: Record<string, unknown>;
}

/**
 * Build a Model handle for a custom endpoint. The stream implementations read
 * `baseUrl` straight off the model, so no registry entry is needed; cost is
 * zeroed because there is no meaningful per-token price for a custom endpoint.
 */
export function buildCustomModel(spec: CustomModelSpec): Model<Api> {
  if (!spec.baseUrl) throw new Error('customModel requires a baseUrl');
  if (!spec.id) throw new Error('customModel requires a model id');
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    api: spec.api ?? 'openai-completions',
    provider: spec.provider ?? 'custom',
    baseUrl: spec.baseUrl,
    reasoning: spec.reasoning ?? false,
    input: spec.input ?? ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: spec.contextWindow ?? 128_000,
    maxTokens: spec.maxTokens ?? 8_192,
    ...(spec.headers ? { headers: spec.headers } : {}),
    ...(spec.compat ? { compat: spec.compat } : {}),
  } as unknown as Model<Api>;
}

/**
 * Hooks the app registers to persist a call's request when it's made, and its
 * error if the call fails — the boundary stays free of any DB/app dependency
 * (dependency inversion). Headless / benchmark runs register none, so nothing
 * is recorded there. (Successful responses are written by the caller after the
 * turn, where the user context lives; the error message is only available here
 * because the engine discards the failed message.)
 */
export interface LlmCallRecorder {
  recordRequest(callId: string, request: Context): void;
  recordError(callId: string, errorMessage: string, responseJson: string): void;
}
const CALL_ID_HEADER = 'X-MX-Request-Call-ID';
let llmCallRecorder: LlmCallRecorder | null = null;
export function setLlmCallRecorder(recorder: LlmCallRecorder | null): void {
  llmCallRecorder = recorder;
}

/** Stream a single model call. Returns a stream of our owned `AssistantMessageEvent`s. */
export function streamSimple(
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): EventStream<AssistantMessageEvent, AssistantMessage> {
  const stream = piStreamSimple(
    model,
    context as unknown as PiContext,
    options as PiSimpleStreamOptions | undefined,
  ) as unknown as EventStream<AssistantMessageEvent, AssistantMessage>;
  const callId = (options?.headers as Record<string, string> | undefined)?.[CALL_ID_HEADER];
  if (callId && llmCallRecorder) {
    const recorder = llmCallRecorder;
    recorder.recordRequest(callId, context);
    // Persist the error if the call fails. result() resolves with the error
    // message (it never rejects); success responses are written after the turn.
    void stream.result().then((msg) => {
      if (msg?.stopReason === 'error') recorder.recordError(callId, msg.errorMessage ?? 'error', JSON.stringify(msg));
    });
  }
  return stream;
}
