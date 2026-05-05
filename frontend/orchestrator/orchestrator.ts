
import {
  EventStream,
  type AssistantMessage,
  type Message,
  type TextContent,
  type ToolCall,
  type ToolResultMessage,
} from '@mariozechner/pi-ai';
import {
  MXAgent,
  MXTool,
  UserInputException,
  type AgentContext,
  type AgentInvocation,
  type ConversationLog,
  type ConversationLogEntry,
  type RegistrableClass,
  type StreamEvent,
  type ToolMessage,
  type ToolResponse,
} from './types';
import { normalizeArgs, synthErrorAssistantMessage } from './utils';

export class Orchestrator {
  log: ConversationLog;
  protected stream: EventStream<StreamEvent, AssistantMessage | null> | null = null;
  protected controller: AbortController | null = null;
  protected readonly registrables: RegistrableClass[];

  constructor(registrables: RegistrableClass[], log?: ConversationLog) {
    this.registrables = registrables;
    this.log = log ?? [];
  }

  get signal(): AbortSignal | undefined {
    return this.controller?.signal;
  }

  emit(event: StreamEvent): void {
    this.stream?.push(event);
  }

  run(root: MXAgent): EventStream<StreamEvent, AssistantMessage | null> {
    this.controller?.abort();
    this.appendInterruptResultsForDanglers();
    this.controller = new AbortController();
    root.threadHistory = this.projectRootThreadHistory();

    const rootCtor = root.constructor as unknown as RegistrableClass & { name: string };
    this.log.push({
      type: 'toolCall',
      id: root.id,
      name: rootCtor.schema?.name ?? rootCtor.name,
      arguments: root.parameters as Record<string, unknown>,
      context: root.context,
      parent_id: null,
    });

    const stream = new EventStream<StreamEvent, AssistantMessage | null>(() => false, () => null);
    this.stream = stream;

    void (async () => {
      let result: AssistantMessage | null = null;
      try {
        const finalMsg = await root.run();
        this.appendAgentResult(finalMsg, root, null);
        result = finalMsg;
      } catch (err) {
        if (err instanceof UserInputException) {
          stream.push({ type: 'pending', toolCallIds: err.toolCallIds });
        } else {
          stream.push(this.synthErrorEvent(root.id, err));
        }
      } finally {
        stream.end(result);
      }
    })();

    return stream;
  }

  resume(completed: { toolCallId: string; response: ToolResponse }[]): EventStream<StreamEvent, AssistantMessage | null> {
    this.controller = new AbortController();

    const byPausedAgent = new Map<string, ToolResultMessage[]>();
    for (const c of completed) {
      let parent_id: string | null = null;
      let toolName: string | null = null;
      for (const e of this.log) {
        if (!('role' in e) || e.role !== 'assistant') continue;
        for (const block of e.content) {
          if (block.type === 'toolCall' && block.id === c.toolCallId) {
            parent_id = e.parent_id;
            toolName = block.name;
            break;
          }
        }
        if (parent_id) break;
      }
      if (parent_id == null) {
        throw new Error(`resume: no parent_id found for toolCallId ${c.toolCallId}`);
      }
      const trm: ToolResultMessage = {
        role: 'toolResult',
        toolCallId: c.toolCallId,
        toolName: toolName ?? 'unknown',
        content: c.response.content,
        isError: c.response.isError,
        details: c.response.details,
        timestamp: Date.now(),
      };
      this.log.push({ ...trm, parent_id });
      if (!byPausedAgent.has(parent_id)) byPausedAgent.set(parent_id, []);
      byPausedAgent.get(parent_id)!.push(trm);
    }

    const stream = new EventStream<StreamEvent, AssistantMessage | null>(() => false, () => null);
    this.stream = stream;

    const processing = new Set<string>();

    const resumeChain = async (
      agentId: string,
      callingAgent: MXAgent | null,
    ): Promise<AssistantMessage | null> => {
      if (processing.has(agentId)) return null;
      if (!this.allToolCallsResolved(agentId)) return null;
      processing.add(agentId);

      const agent = this.reconstructAgent(agentId);
      const finalMsg = await agent.run();
      this.appendAgentResult(finalMsg, agent, callingAgent);

      if (callingAgent === null) return finalMsg;
      return resumeChain(callingAgent.id, this.findCallingAgent(callingAgent.id));
    };

    void (async () => {
      let rootResult: AssistantMessage | null = null;
      try {
        const results = await Promise.all(
          Array.from(byPausedAgent.keys()).map((id) =>
            resumeChain(id, this.findCallingAgent(id)),
          ),
        );
        rootResult = results.find((r) => r !== null) ?? null;
      } catch (err) {
        if (err instanceof UserInputException) {
          stream.push({ type: 'pending', toolCallIds: err.toolCallIds });
        } else {
          stream.push(this.synthErrorEvent('unknown', err));
        }
      } finally {
        stream.end(rootResult);
      }
    })();

    return stream;
  }

  async dispatch(message: AssistantMessage, parent: MXAgent): Promise<void> {
    this.log.push({ ...message, parent_id: parent.id });
    parent.toolThread.push(message);

    const toolCalls = message.content.filter((c): c is ToolCall => c.type === 'toolCall');
    if (toolCalls.length === 0) return;

    const settled = await Promise.allSettled(
      toolCalls.map(async (tc) => {
        const Cls = this.lookupCallable(tc.name);
        const instance = this.instantiate(Cls, tc.arguments, parent.context, tc.id);

        if (instance instanceof MXAgent) {
          const subFinal = await (instance as MXAgent).run();
          this.appendAgentResult(subFinal as AssistantMessage, instance as MXAgent, parent);
          return { tc, handled: true as const };
        }
        const response = (await instance.run()) as ToolResponse;
        return { tc, handled: false as const, response };
      }),
    );

    const pending: string[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        if (r.value.handled) continue;
        const { tc, response } = r.value;
        const trm: ToolResultMessage = {
          role: 'toolResult',
          toolCallId: tc.id,
          toolName: tc.name,
          content: response.content,
          isError: response.isError,
          details: response.details,
          timestamp: Date.now(),
        };
        this.log.push({ ...trm, parent_id: parent.id });
        parent.toolThread.push(trm);
      } else {
        const err = r.reason;
        if (err instanceof UserInputException) {
          pending.push(...err.toolCallIds);
        } else {
          throw err;
        }
      }
    }
    if (pending.length > 0) throw new UserInputException(pending);
  }

  private appendAgentResult(
    msg: AssistantMessage,
    agent: MXAgent,
    callingAgent: MXAgent | null,
  ): void {
    if (callingAgent === null) {
      this.log.push({ ...msg, parent_id: agent.id });
      agent.toolThread.push(msg);
      return;
    }
    const ctor = agent.constructor as unknown as RegistrableClass;
    const trm: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: agent.id,
      toolName: ctor.schema.name,
      content: msg.content.filter((c): c is TextContent => c.type === 'text'),
      isError: msg.stopReason === 'error',
      timestamp: Date.now(),
    };
    this.log.push({ ...trm, parent_id: callingAgent.id });
    callingAgent.toolThread.push(trm);
  }

  reconstructAgent(invocationId: string): MXAgent {
    const rootInv = this.findRootInvocation(invocationId);
    if (rootInv) {
      return this.instantiate(
        this.lookupCallable(rootInv.name),
        rootInv.arguments,
        rootInv.context,
        invocationId,
        this.projectRootThreadHistory(),
        this.collectToolThread(invocationId),
      ) as MXAgent;
    }

    const sub = this.findSubAgentToolCall(invocationId);
    if (!sub) throw new Error(`reconstructAgent: invocation ${invocationId} not found`);

    const parentAgent = this.reconstructAgent(sub.assistantParentId);
    return this.instantiate(
      this.lookupCallable(sub.toolCall.name),
      sub.toolCall.arguments,
      parentAgent.context,
      invocationId,
      [],
      this.collectToolThread(invocationId),
    ) as MXAgent;
  }

  protected findCallingAgent(agentId: string): MXAgent | null {
    const sub = this.findSubAgentToolCall(agentId);
    if (!sub) return null;
    return this.reconstructAgent(sub.assistantParentId);
  }

  protected allToolCallsResolved(agentId: string): boolean {
    let lastDispatched: AssistantMessage | null = null;
    const resolvedToolCallIds = new Set<string>();
    for (const e of this.log) {
      if (e.parent_id !== agentId) continue;
      if ('role' in e && e.role === 'assistant') {
        if (e.content.some((c) => c.type === 'toolCall')) lastDispatched = e;
      } else if ('role' in e && e.role === 'toolResult') {
        resolvedToolCallIds.add(e.toolCallId);
      }
    }
    if (!lastDispatched) return true;
    return lastDispatched.content
      .filter((c): c is ToolCall => c.type === 'toolCall')
      .every((tc) => resolvedToolCallIds.has(tc.id));
  }

  protected lookupCallable(name: string): RegistrableClass {
    const cls = this.registrables.find((r) => r.schema?.name === name);
    if (!cls) {
      throw new Error(`No callable with schema.name='${name}' in orchestrator registrables`);
    }
    return cls;
  }

  protected instantiate(
    Cls: RegistrableClass,
    args: Record<string, unknown>,
    ctx: AgentContext,
    id: string,
    threadHistory?: Message[],
    toolThread?: ToolMessage[],
  ): MXTool {
    const normalized = normalizeArgs(Cls.schema.parameters, args);
    const Ctor = Cls as unknown as new (
      o: Orchestrator,
      p: Record<string, unknown>,
      c: AgentContext,
      id?: string,
      th?: Message[],
      tt?: ToolMessage[],
    ) => MXTool;
    return new Ctor(this, normalized as Record<string, unknown>, ctx, id, threadHistory, toolThread);
  }

  protected projectRootThreadHistory(): Message[] {
    const out: Message[] = [];
    let currentRootId: string | null = null;
    for (const e of this.log) {
      if (this.isAgentInvocation(e) && e.parent_id === null) {
        out.push({
          role: 'user',
          content: ((e.arguments as { userMessage?: string }).userMessage ?? '') as string,
          timestamp: Date.now(),
        });
        currentRootId = e.id;
      } else if (
        'role' in e &&
        e.role === 'assistant' &&
        e.parent_id === currentRootId &&
        e.stopReason === 'stop'
      ) {
        out.push(e);
      }
    }
    return out;
  }

  protected findRootInvocation(id: string): AgentInvocation | null {
    for (const e of this.log) {
      if (this.isAgentInvocation(e) && e.id === id && e.parent_id === null) return e;
    }
    return null;
  }

  protected findSubAgentToolCall(
    id: string,
  ): { toolCall: ToolCall; assistantParentId: string } | null {
    for (const e of this.log) {
      if (!('role' in e) || e.role !== 'assistant') continue;
      for (const block of e.content) {
        if (block.type === 'toolCall' && block.id === id) {
          if (e.parent_id == null) return null;
          return { toolCall: block, assistantParentId: e.parent_id };
        }
      }
    }
    return null;
  }

  protected collectToolThread(invocationId: string): ToolMessage[] {
    const out: ToolMessage[] = [];
    for (const e of this.log) {
      if (e.parent_id !== invocationId) continue;
      if ('role' in e && (e.role === 'assistant' || e.role === 'toolResult')) {
        out.push(e);
      }
    }
    return out;
  }

  protected isAgentInvocation(e: ConversationLogEntry): e is AgentInvocation & { parent_id: string | null } {
    return (e as { type?: string }).type === 'toolCall' && 'context' in e;
  }

  protected appendInterruptResultsForDanglers(): void {
    const danglers = new Map<string, { name: string; parent_id: string | null }>();
    const resolved = new Set<string>();
    for (const e of this.log) {
      if ('role' in e && e.role === 'assistant') {
        for (const c of e.content) {
          if (c.type === 'toolCall') danglers.set(c.id, { name: c.name, parent_id: e.parent_id });
        }
      } else if ('role' in e && e.role === 'toolResult') {
        resolved.add(e.toolCallId);
      }
    }
    for (const [id, info] of danglers) {
      if (resolved.has(id)) continue;
      this.log.push({
        role: 'toolResult',
        toolCallId: id,
        toolName: info.name,
        content: [{ type: 'text', text: 'interrupted' }],
        isError: true,
        timestamp: Date.now(),
        parent_id: info.parent_id,
      });
    }
  }

  protected synthErrorEvent(parent_id: string, err: unknown): StreamEvent {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      type: 'error',
      reason: 'error',
      error: synthErrorAssistantMessage(errorMessage),
      parent_id,
    } as StreamEvent;
  }
}
