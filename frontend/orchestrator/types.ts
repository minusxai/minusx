
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
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { gen_id } from './utils';

export interface ConnectionInfo {
  name: string;
  dialect: string;
  description?: string;
}

export interface AgentContext {
  userId: string;
  connectionId?: string;
  mode: 'org' | 'tutorial';
  appState?: unknown;
  connections?: ConnectionInfo[];
  effectiveUser?: EffectiveUser;
}

export interface ToolResponse<TDetails = Record<string, unknown>> {
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
}

export type ToolMessage = AssistantMessage | ToolResultMessage;

export type RegistrableClass = {
  readonly schema: Tool<TSchema>;
  new (
    orchestrator: Orchestrator,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: any,
    context: AgentContext,
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

  protected buildUserContent(): (TextContent | ImageContent)[] {
    const raw = this.userMessage;
    const items: (TextContent | ImageContent)[] =
      typeof raw === 'string' ? [{ type: 'text', text: raw }] : raw;

    const images = items.filter((c): c is ImageContent => c.type === 'image');
    const goal = items
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    const appStateJson =
      this.context.appState !== undefined ? JSON.stringify(this.context.appState) : 'null';
    const date = new Date().toISOString().slice(0, 10);

    return [
      { type: 'text', text: `<AppState>${appStateJson}</AppState>\n<CurrentDate>${date}</CurrentDate>` },
      ...images,
      { type: 'text', text: `<Question>${goal}</Question>` },
    ];
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
