// Host runtime for the MinusX agent system. Owns the append-only
// ConversationLog and the unified event stream. Stateless reconstruction:
// rebuilds agents from log on resume() via the registrables array.
//
// Base classes (MXTool, MXAgent) and the data types live in ./types.ts.
// Helpers (gen_id, EMPTY_USAGE) live in ./utils.ts.

import {
  EventStream,
  type Api,
  type AssistantMessage,
  type Message,
  type ToolCall,
  type ToolResultMessage,
} from '@mariozechner/pi-ai';
import {
  UserInputException,
  type AgentContext,
  type AgentInvocation,
  type ConversationLog,
  type ConversationLogEntry,
  type MXAgent,
  type MXTool,
  type RegistrableClass,
  type StreamEvent,
  type ToolMessage,
  type ToolResponse,
} from './types';
import { EMPTY_USAGE } from './utils';

export class Orchestrator {
  // Public read access — host UI / tests inspect the log directly.
  log: ConversationLog;
  protected stream: EventStream<StreamEvent, ToolResponse | null> | null = null;
  protected controller: AbortController | null = null;
  protected readonly registrables: RegistrableClass[];

  constructor(registrables: RegistrableClass[], log?: ConversationLog) {
    this.registrables = registrables;
    this.log = log ?? [];
  }

  // Threaded into pi-ai stream calls so the host (or a new run()) can abort.
  get signal(): AbortSignal | undefined {
    return this.controller?.signal;
  }

  // Push a wrapped pi-ai event (or 'pending') to the active stream. Called by
  // base llm() as pi-ai chunks arrive.
  emit(event: StreamEvent): void {
    this.stream?.push(event);
  }

  // Start a new run rooted at `root`. Interrupts any in-flight run by
  // aborting the previous controller and inlining synthetic 'interrupted'
  // ToolResultMessages for any dangling tool_calls in the log.
  run(root: MXAgent): EventStream<StreamEvent, ToolResponse | null> {
    this.controller?.abort();

    // Interrupt danglers: for each tool_call without a matching tool_result,
    // append a synthetic 'interrupted' result so the log stays consistent.
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

    this.controller = new AbortController();
    root.threadHistory = this.projectRootThreadHistory();

    // Append AgentInvocation for root (parent_id=null).
    const rootCtor = root.constructor as unknown as RegistrableClass & { name: string };
    this.log.push({
      type: 'toolCall',
      id: root.id,
      name: rootCtor.schema?.name ?? rootCtor.name,
      arguments: root.parameters as Record<string, unknown>,
      context: root.context,
      parent_id: null,
    });

    const stream = new EventStream<StreamEvent, ToolResponse | null>(() => false, () => null);
    this.stream = stream;

    void (async () => {
      let result: ToolResponse | null = null;
      try {
        result = (await root.run()) as ToolResponse;
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

  // Host calls this when frontend-executed tool results arrive. Does NOT
  // interrupt other in-flight work.
  resume(completed: { toolCallId: string; response: ToolResponse }[]): EventStream<StreamEvent, ToolResponse | null> {
    this.controller = new AbortController();

    // Append each result. parent_id + toolName are looked up via a single
    // log scan per toolCallId (tool_calls only ever live inside an assistant
    // message's content array).
    const byParent = new Map<string, ToolResultMessage[]>();
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
      if (!byParent.has(parent_id)) byParent.set(parent_id, []);
      byParent.get(parent_id)!.push(trm);
    }

    const stream = new EventStream<StreamEvent, ToolResponse | null>(() => false, () => null);
    this.stream = stream;

    void (async () => {
      let rootResult: ToolResponse | null = null;
      try {
        await Promise.all(
          Array.from(byParent.keys()).map(async (parentId) => {
            const agent = this.reconstructAgent(parentId);
            const result = await agent.run();
            // Capture the result if this agent is the root — its ToolResponse
            // is the run's final output exposed via stream.result().
            if (this.findRootInvocation(parentId)) rootResult = result as ToolResponse;
          }),
        );
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

  // Single mutation site per LLM turn. Appends the AssistantMessage, then
  // executes any tool_calls in parallel. AssistantMessages with no tool_calls
  // (stop) still go through here for log consistency.
  async dispatch(message: AssistantMessage, parent: MXAgent): Promise<void> {
    this.log.push({ ...message, parent_id: parent.id });
    parent.toolThread.push(message);

    const toolCalls = message.content.filter((c): c is ToolCall => c.type === 'toolCall');
    if (toolCalls.length === 0) return;

    const settled = await Promise.allSettled(
      toolCalls.map(async (tc) => {
        const Cls = this.lookupCallable(tc.name);
        const Ctor = Cls as unknown as new (
          o: Orchestrator,
          p: Record<string, unknown>,
          c: AgentContext,
          id?: string,
        ) => MXTool;
        const instance = new Ctor(this, tc.arguments, parent.context, tc.id);
        const response = await instance.run();
        return { tc, response };
      }),
    );

    const pending: string[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
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

  // Stateless rebuild of an agent from log. Looks up the class in
  // registrables by schema.name. Root: from AgentInvocation entry. Sub-agent:
  // from the ToolCall in the parent's AssistantMessage.
  reconstructAgent(invocationId: string): MXAgent {
    const rootInv = this.findRootInvocation(invocationId);
    if (rootInv) {
      const Cls = this.lookupCallable(rootInv.name);
      const Ctor = Cls as unknown as new (
        o: Orchestrator,
        p: Record<string, unknown>,
        c: AgentContext,
        id?: string,
        th?: Message[],
        tt?: ToolMessage[],
      ) => MXAgent;
      return new Ctor(
        this,
        rootInv.arguments,
        rootInv.context,
        invocationId,
        this.projectRootThreadHistory(),
        this.collectToolThread(invocationId),
      );
    }

    // Sub-agent: find its invoking ToolCall in the log.
    let subToolCall: ToolCall | null = null;
    let assistantParentId: string | null = null;
    for (const e of this.log) {
      if (!('role' in e) || e.role !== 'assistant') continue;
      for (const block of e.content) {
        if (block.type === 'toolCall' && block.id === invocationId) {
          subToolCall = block;
          assistantParentId = e.parent_id;
          break;
        }
      }
      if (subToolCall) break;
    }
    if (!subToolCall || !assistantParentId) {
      throw new Error(`reconstructAgent: invocation ${invocationId} not found`);
    }

    // Walk up just for context inheritance.
    const parentAgent = this.reconstructAgent(assistantParentId);
    const Cls = this.lookupCallable(subToolCall.name);
    const Ctor = Cls as unknown as new (
      o: Orchestrator,
      p: Record<string, unknown>,
      c: AgentContext,
      id?: string,
      th?: Message[],
      tt?: ToolMessage[],
    ) => MXAgent;
    return new Ctor(
      this,
      subToolCall.arguments,
      parentAgent.context,
      invocationId,
      [], // sub-agents have empty threadHistory
      this.collectToolThread(invocationId),
    );
  }

  // ===== Helpers (each called from 2+ sites) =====

  protected lookupCallable(name: string): RegistrableClass {
    const cls = this.registrables.find((r) => r.schema?.name === name);
    if (!cls) {
      throw new Error(`No callable with schema.name='${name}' in orchestrator registrables`);
    }
    return cls;
  }

  // Project prior root turns into a Message[] for the new root's threadHistory.
  // Each prior root: UserMessage from arguments.userMessage, then any of its
  // AssistantMessages with stopReason='stop' (the LLM-visible reply).
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

  protected synthErrorEvent(parent_id: string, err: unknown): StreamEvent {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      type: 'error',
      reason: 'error',
      error: {
        role: 'assistant',
        content: [{ type: 'text', text: errorMessage }],
        api: 'unknown' as Api,
        provider: 'unknown',
        model: 'unknown',
        usage: EMPTY_USAGE,
        stopReason: 'error',
        errorMessage,
        timestamp: Date.now(),
      },
      parent_id,
    } as StreamEvent;
  }
}
