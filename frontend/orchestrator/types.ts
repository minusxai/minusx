// Public types and base classes that consumers extend (tools and agents).
// The host runtime (Orchestrator) lives in ./orchestrator.ts.
//
// MXTool and MXAgent reference Orchestrator only via `import type`, so this
// module has no runtime dependency on orchestrator.ts — no cycle.

import {
  streamSimple,
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

// ============================================================================
// Agent context + tool response
// ============================================================================

export interface AgentContext {
  userId: string;
  connectionId?: string;
  mode: 'org' | 'tutorial';
}

export interface ToolResponse<TDetails = Record<string, unknown>> {
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
}

// ============================================================================
// Schema constraints
// ============================================================================

// TypeBox v1.x exposes `TSchema` as an empty interface — its phantom `static`
// field is no longer structurally accessible. So we cannot encode "TParams
// must produce a Static that includes userMessage" purely at the type level.
// Subclasses are still expected to declare a schema that includes userMessage;
// validation happens at the LLM boundary via TypeBox.Validate.
export type AgentTParams = TSchema;
export type ToolMessage = AssistantMessage | ToolResultMessage;

// Constraint for the Orchestrator's registrables array.
export type RegistrableClass = {
  readonly schema: Tool<TSchema>;
};

// ============================================================================
// Conversation log
// ============================================================================

// AgentInvocation is a ToolCall + context. `name` (inherited from ToolCall) is
// the registry-key used for stateless reconstruction. Fully serializable.
// Only present at the root of a run; sub-agent invocations are captured by
// the ToolCall inside the parent's AssistantMessage.
export interface AgentInvocation extends ToolCall {
  context: AgentContext;
}

export type ConversationLogEntry =
  (AgentInvocation | AssistantMessage | ToolResultMessage) & { parent_id: string | null };

export type ConversationLog = ConversationLogEntry[];

// ============================================================================
// Stream events
// ============================================================================

// Stream events flowing out of Orchestrator.run / Orchestrator.resume. Every
// pi-ai AssistantMessageEvent is forwarded with the producing agent's id;
// plus 'pending' to signal UserInputException to the host.
export type StreamEvent =
  | (AssistantMessageEvent & { parent_id: string })
  | { type: 'pending'; toolCallIds: string[] };

// ============================================================================
// Errors / contract signals
// ============================================================================

export class UserInputException extends Error {
  readonly toolCallIds: string[];
  constructor(ids: string | string[]) {
    const arr = Array.isArray(ids) ? ids : [ids];
    super(`User input required for tool calls: ${arr.join(', ')}`);
    this.name = 'UserInputException';
    this.toolCallIds = arr;
  }
}

// ============================================================================
// MXTool — base callable
// ============================================================================

export abstract class MXTool<
  TParams extends TSchema = TSchema,
  TContext extends AgentContext = AgentContext,
  TDetails = unknown,
> {
  static readonly type: string = 'Tool';
  // Subclass narrows: `static readonly schema: Tool<typeof MyParams>`.
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

  // Tools return ToolResponse; agents (MXAgent subclasses) narrow to
  // AssistantMessage. dispatch branches on `instanceof MXAgent` to handle
  // the two shapes — see Orchestrator.appendAgentResult.
  abstract run(): Promise<ToolResponse<TDetails> | AssistantMessage>;
}

// ============================================================================
// MXAgent — extends MXTool, owns its toolThread, dispatches via orchestrator
// ============================================================================

export class MXAgent<
  TParams extends AgentTParams = AgentTParams,
  TContext extends AgentContext = AgentContext,
  TDetails = unknown,
> extends MXTool<TParams, TContext, TDetails> {
  static readonly type: string = 'Agent';
  static readonly model: Model<Api>;
  // Tool schemas advertised to the LLM (passed to pi-ai's Context.tools).
  // Class lookup for construction goes through Orchestrator.registrables.
  static readonly tools: Tool<TSchema>[] = [];

  protected systemPrompt = '';
  // Public for orchestrator access (project from log, mutate during dispatch).
  // Subclasses can still read these freely.
  threadHistory: Message[];
  userMessage: string | (TextContent | ImageContent)[];
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
    // userMessage required by AgentTParams contract (runtime-validated, not
    // type-enforced — see AgentTParams comment).
    this.userMessage = (parameters as { userMessage: string | (TextContent | ImageContent)[] }).userMessage;
  }

  // Build the pi-ai message array for the next LLM turn.
  buildMessages(): Message[] {
    return [
      ...this.threadHistory,
      { role: 'user', content: this.userMessage, timestamp: Date.now() } as Message,
      ...this.toolThread,
    ];
  }

  // Subclasses can override (e.g. for scripted tests or custom prompts).
  // Default implementation: call pi-ai with model + tools + buildMessages(),
  // forward each event into the orchestrator's stream wrapped with parent_id,
  // return the final AssistantMessage.
  protected async llm(): Promise<AssistantMessage> {
    const ctor = this.constructor as typeof MXAgent;
    const context: Context = {
      systemPrompt: this.systemPrompt,
      messages: this.buildMessages(),
      tools: ctor.tools,
    };
    const stream = streamSimple(ctor.model, context, { signal: this.orchestrator.signal });

    let result: AssistantMessage | null = null;
    for await (const ev of stream) {
      this.orchestrator.emit({ ...ev, parent_id: this.id });
      if (ev.type === 'done') result = ev.message;
      else if (ev.type === 'error') result = ev.error;
    }
    if (!result) {
      throw new Error(`${this.constructor.name}.llm: stream ended without done/error event`);
    }
    return result;
  }

  // Loop: llm() → (dispatch unless stop) → repeat. The stop turn is NOT
  // dispatched here — the caller (Orchestrator.run for root, Orchestrator.
  // dispatch for sub-agents) decides how to log it via appendAgentResult.
  async run(): Promise<AssistantMessage> {
    while (true) {
      const msg = await this.llm();
      if (msg.stopReason === 'stop') return msg;
      // Cast to base MXAgent — TS gets pickier about generic variance after
      // the file split (protected-field visibility check on `this`).
      await this.orchestrator.dispatch(msg, this as unknown as MXAgent);
    }
  }
}
