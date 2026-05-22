
import type { Static, TSchema } from 'typebox';
import type { AssistantMessage, AssistantMessageEvent, Context, ImageContent, Message, Model, TextContent, Tool, ToolCall, ToolResultMessage, Api } from '@/orchestrator/llm';
import type { Orchestrator } from './orchestrator';
import { gen_id } from './utils';

/**
 * Empty by design. Each agent extends this with the context shape its tools
 * need (e.g. `AnalystAgentContext` carries `userId`, `effectiveUser`,
 * `connections`, etc.). The orchestrator never dereferences context fields —
 * it just passes the object through to tools/agents.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AgentContext {}

export interface ToolResponse<TDetails = Record<string, unknown>> {
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
}

export type ToolMessage = AssistantMessage | ToolResultMessage;

// `parameters` and `context` are bivariant `any` so RegistrableClass is
// assignable from subclasses with narrower TParams / TContext (e.g.
// MXTool<typeof MyParams, MyContext>). The orchestrator passes objects through
// without dereferencing fields — type safety at the construction site is the
// caller's job, not the registry's.
export type RegistrableClass = {
  readonly schema: Tool<TSchema>;
  new (
    orchestrator: Orchestrator,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: any,
    id?: string,
    threadHistory?: Message[],
    toolThread?: ToolMessage[],
  ): MXTool;
};

export interface AgentInvocation extends ToolCall {
  context: AgentContext;
}

export interface MXAgentDetails {
  type: 'mx_agent';
  assistantMessage: AssistantMessage;
}

export type ConversationLogEntry =
  (AgentInvocation | AssistantMessage | ToolResultMessage) & { parent_id: string | null };

export type ConversationLog = ConversationLogEntry[];

export interface PendingToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  context: AgentContext;
  parent_id: string;
}

export interface PendingToolEvent extends PendingToolCall {
  type: 'pending';
}

export type StreamEvent =
  | (AssistantMessageEvent & { parent_id: string })
  | PendingToolEvent;

// ── Activity tracking ────────────────────────────────────────────────────
// Lightweight lifecycle events for observability (benchmark runner, etc.).
// The orchestrator fires these via an optional callback; they carry no
// payload beyond what's needed to render a one-line status.

export type ActivityEvent =
  | { phase: 'llm'; status: 'start' }
  | { phase: 'llm'; status: 'end' }
  | { phase: 'tool'; status: 'start'; name: string }
  | { phase: 'tool'; status: 'end'; name: string }
  | { phase: 'agent'; status: 'start'; name: string }
  | { phase: 'agent'; status: 'end'; name: string };

export type ActivityCallback = (event: ActivityEvent) => void;

export class UserInputException extends Error {
  readonly toolCallIds: string[];
  constructor(ids: string | string[]) {
    const arr = Array.isArray(ids) ? ids : [ids];
    super(`User input required for tool calls: ${arr.join(', ')}`);
    this.name = 'UserInputException';
    this.toolCallIds = arr;
  }
}

export abstract class MXTool<
  TParams extends TSchema = TSchema,
  TContext extends AgentContext = AgentContext,
  TDetails = unknown,
> {
  static readonly type: string = 'Tool';
  static readonly schema: Tool<TSchema>;

  readonly id: string;
  readonly parameters: Static<TParams>;
  readonly context: TContext;
  protected readonly orchestrator: Orchestrator;

  constructor(
    orchestrator: Orchestrator,
    parameters: Static<TParams>,
    context: TContext,
    id?: string,
  ) {
    this.parameters = parameters;
    this.context = context;
    this.orchestrator = orchestrator;
    this.id = id ?? gen_id();
  }

  abstract run(): Promise<ToolResponse<TDetails> | AssistantMessage>;
}

export class MXAgent<
  TParams extends TSchema = TSchema,
  TContext extends AgentContext = AgentContext,
  TDetails = unknown,
> extends MXTool<TParams, TContext, TDetails> {
  static readonly type: string = 'Agent';
  static readonly model: Model<Api>;
  static readonly tools: Tool<TSchema>[] = [];
  /**
   * Hard cap on the agentic loop, counted in `toolThread` entries (assistant +
   * tool-result messages), mirroring the Python backend's MAX_STEPS_LOWER_LEVEL.
   * The loop stops with a "Maximum iterations (N) reached." reply at the cap,
   * and tools are withheld once the thread reaches `maxSteps − 5` so the model
   * is forced to give a final answer. Default `Infinity` = uncapped (concrete
   * agents opt in by declaring a finite value).
   */
  static readonly maxSteps: number = Infinity;
  /** Call-time options spread blindly into `streamSimple` (matches
   *  `SimpleStreamOptions`: `reasoning`, `thinkingBudgets`, `metadata`,
   *  `maxRetryDelayMs`, …). Subclasses set this from env config; the
   *  orchestrator never inspects individual keys. */
  static readonly callOptions: Record<string, unknown> | undefined = undefined;

  threadHistory: Message[];
  toolThread: ToolMessage[];

  constructor(
    orchestrator: Orchestrator,
    parameters: Static<TParams>,
    context: TContext,
    id?: string,
    threadHistory?: Message[],
    toolThread?: ToolMessage[],
  ) {
    super(orchestrator, parameters, context, id);
    this.threadHistory = threadHistory ?? [];
    this.toolThread = toolThread ?? [];
  }

  get userMessage(): string | (TextContent | ImageContent)[] {
    return (this.parameters as { userMessage: string | (TextContent | ImageContent)[] }).userMessage;
  }

  protected getSystemPrompt(): string {
    return '';
  }

  /**
   * Default: wraps `userMessage` as a single user-message content array.
   * Subclasses (e.g. `AnalystAgent`) override to inject app-specific blocks
   * like `<AppState>`/`<CurrentDate>`/`<Question>`.
   */
  protected buildUserContent(): (TextContent | ImageContent)[] {
    const raw = this.userMessage;
    return typeof raw === 'string' ? [{ type: 'text', text: raw }] : raw;
  }

  buildMessages(): Message[] {
    return [
      ...this.threadHistory,
      { role: 'user', content: this.buildUserContent(), timestamp: Date.now() } as Message,
      ...this.toolThread,
    ];
  }

  /**
   * Per-request stream options. Defaults to the static `callOptions`; override
   * to inject per-turn options derived from the agent's context (e.g. the
   * WebAnalystAgent adds web-search `userLocation` from `context.city`).
   */
  protected resolveCallOptions(): Record<string, unknown> | undefined {
    return (this.constructor as typeof MXAgent).callOptions;
  }

  protected async llm(): Promise<AssistantMessage> {
    const ctor = this.constructor as typeof MXAgent;
    // Soft cap (matches Python's _get_available_tools): once the thread reaches
    // maxSteps − 5, withhold tools so the model must give a final answer.
    const tools = this.toolThread.length >= ctor.maxSteps - 5 ? [] : ctor.tools;
    const context: Context = {
      systemPrompt: this.getSystemPrompt(),
      messages: this.buildMessages(),
      tools,
    };
    return this.orchestrator.callLLM(ctor.model, context, this.id, this.resolveCallOptions());
  }

  async run(): Promise<AssistantMessage> {
    const ctor = this.constructor as typeof MXAgent;
    let lastMsg: AssistantMessage | undefined;
    // Hard cap (matches Python's `while len(tool_thread) < MAX_STEPS`).
    while (this.toolThread.length < ctor.maxSteps) {
      lastMsg = await this.llm();
      if (lastMsg.stopReason === 'stop') return lastMsg;
      await this.orchestrator.dispatch(lastMsg, this as unknown as MXAgent);
    }
    // Hit the cap. Reuse the last assistant message's provider metadata (api,
    // usage, model, …) and replace its content, mirroring Python's terminal
    // "Maximum iterations (N) reached." reply.
    const template =
      lastMsg ??
      [...this.toolThread].reverse().find((m): m is AssistantMessage => m.role === 'assistant');
    return {
      ...(template as AssistantMessage),
      content: [{ type: 'text', text: `Maximum iterations (${ctor.maxSteps}) reached.` }],
      stopReason: 'stop',
      errorMessage: undefined,
      timestamp: Date.now(),
    };
  }
}
