
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type ImageContent,
  type Message,
  type Model,
  type Static,
  type TextContent,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
  type TSchema,
  type Api,
} from '@mariozechner/pi-ai';
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

  protected async llm(): Promise<AssistantMessage> {
    const ctor = this.constructor as typeof MXAgent;
    const context: Context = {
      systemPrompt: this.getSystemPrompt(),
      messages: this.buildMessages(),
      tools: ctor.tools,
    };
    return this.orchestrator.callLLM(ctor.model, context, this.id);
  }

  async run(): Promise<AssistantMessage> {
    while (true) {
      const msg = await this.llm();
      if (msg.stopReason === 'stop') return msg;
      await this.orchestrator.dispatch(msg, this as unknown as MXAgent);
    }
  }
}
