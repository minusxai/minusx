// Host runtime for the MinusX agent system. Owns the append-only
// ConversationLog and the unified event stream. Stateless reconstruction:
// rebuilds agents from log on resume() via the registrables array.
//
// Base classes (MXTool, MXAgent) and the data types live in ./types.ts.
// Helpers (gen_id, EMPTY_USAGE, normalizeArgs) live in ./utils.ts.

import {
  EventStream,
  type Api,
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
import { EMPTY_USAGE, normalizeArgs } from './utils';

export class Orchestrator {
  // Public read access — host UI / tests inspect the log directly.
  log: ConversationLog;
  protected stream: EventStream<StreamEvent, AssistantMessage | null> | null = null;
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
  run(root: MXAgent): EventStream<StreamEvent, AssistantMessage | null> {
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

    const stream = new EventStream<StreamEvent, AssistantMessage | null>(() => false, () => null);
    this.stream = stream;

    void (async () => {
      let result: AssistantMessage | null = null;
      try {
        const finalMsg = await root.run();
        // root.run() returns the stop AssistantMessage (skip-dispatch-on-stop).
        // appendAgentResult logs it as AssistantMessage in the root case.
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

  // Host calls this when frontend-executed tool results arrive. Does NOT
  // interrupt other in-flight work. Bubbles results up the agent chain:
  // when a paused agent finishes, its result lands in the calling agent's
  // thread, and the calling agent re-runs once all its outstanding
  // tool_calls are resolved.
  resume(completed: { toolCallId: string; response: ToolResponse }[]): EventStream<StreamEvent, AssistantMessage | null> {
    this.controller = new AbortController();

    // (a) Append each result to log + collect by paused agent id.
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

    // Tracks agents already resumed in this call to avoid re-running on
    // multiple bubble-up paths (e.g. parallel sub-agents converging on root).
    const processing = new Set<string>();

    const resumeChain = async (
      agentId: string,
      callingAgent: MXAgent | null,
    ): Promise<AssistantMessage | null> => {
      if (processing.has(agentId)) return null;
      // Bubble guard: only proceed if this agent's last dispatched turn has
      // matching tool_results for every tool_call. Sibling children must
      // resolve before the agent re-runs.
      if (!this.allToolCallsResolved(agentId)) return null;
      processing.add(agentId);

      const agent = this.reconstructAgent(agentId);
      const finalMsg = await agent.run();   // may throw UIE if pauses again
      this.appendAgentResult(finalMsg, agent, callingAgent);

      if (callingAgent === null) return finalMsg;   // root reached
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

  // Mid-loop mutation site: appends the AssistantMessage to log + parent's
  // toolThread, then executes any tool_calls in parallel. The stop turn is
  // NOT routed through here — MXAgent.run() returns it directly and the
  // caller (Orchestrator.run for root, dispatch's sub-agent branch for
  // nested agents) decides how to log it via appendAgentResult.
  async dispatch(message: AssistantMessage, parent: MXAgent): Promise<void> {
    this.log.push({ ...message, parent_id: parent.id });
    parent.toolThread.push(message);

    const toolCalls = message.content.filter((c): c is ToolCall => c.type === 'toolCall');
    if (toolCalls.length === 0) return;

    const settled = await Promise.allSettled(
      toolCalls.map(async (tc) => {
        const Cls = this.lookupCallable(tc.name);
        const normalized = normalizeArgs(Cls.schema.parameters, tc.arguments);
        const Ctor = Cls as unknown as new (
          o: Orchestrator,
          p: Record<string, unknown>,
          c: AgentContext,
          id?: string,
        ) => MXTool;
        const instance = new Ctor(this, normalized as Record<string, unknown>, parent.context, tc.id);

        if (instance instanceof MXAgent) {
          // Sub-agent: run it, then route its final AssistantMessage through
          // appendAgentResult (which wraps as ToolResultMessage in parent).
          const subFinal = await (instance as MXAgent).run();
          // run() returns AssistantMessage — narrow via cast (the union
          // signature on MXTool.run() doesn't auto-narrow here).
          this.appendAgentResult(subFinal as AssistantMessage, instance as MXAgent, parent);
          return { tc, handled: true as const };
        }
        // Plain tool: ToolResponse path (existing behavior).
        const response = (await instance.run()) as ToolResponse;
        return { tc, handled: false as const, response };
      }),
    );

    const pending: string[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        if (r.value.handled) continue; // sub-agent already logged via appendAgentResult
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

  // Single decision point for "log final agent result as AssistantMessage
  // (root) or wrap as ToolResultMessage (sub-agent invoked by another agent)".
  private appendAgentResult(
    msg: AssistantMessage,
    agent: MXAgent,
    callingAgent: MXAgent | null,
  ): void {
    if (callingAgent === null) {
      // Root case → log as AssistantMessage.
      this.log.push({ ...msg, parent_id: agent.id });
      agent.toolThread.push(msg);
      return;
    }
    // Sub-agent case → wrap as ToolResultMessage in calling agent's thread.
    const ctor = agent.constructor as unknown as RegistrableClass;
    const trm: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: agent.id,
      toolName: ctor.schema.name,
      // AssistantMessage.content can hold TextContent | ThinkingContent | ToolCall;
      // ToolResultMessage.content takes TextContent | ImageContent. Strip down
      // to text — thinking/tool_call shouldn't appear in a stop turn anyway.
      content: msg.content.filter((c): c is TextContent => c.type === 'text'),
      isError: msg.stopReason === 'error',
      timestamp: Date.now(),
    };
    this.log.push({ ...trm, parent_id: callingAgent.id });
    callingAgent.toolThread.push(trm);
  }

  // Stateless rebuild of an agent from log. Looks up the class in
  // registrables by schema.name. Root: from AgentInvocation entry. Sub-agent:
  // from the ToolCall in the parent's AssistantMessage.
  reconstructAgent(invocationId: string): MXAgent {
    const rootInv = this.findRootInvocation(invocationId);
    if (rootInv) {
      const Cls = this.lookupCallable(rootInv.name);
      const normalized = normalizeArgs(Cls.schema.parameters, rootInv.arguments);
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
        normalized as Record<string, unknown>,
        rootInv.context,
        invocationId,
        this.projectRootThreadHistory(),
        this.collectToolThread(invocationId),
      );
    }

    // Sub-agent: find its invoking ToolCall in the log.
    const sub = this.findSubAgentToolCall(invocationId);
    if (!sub) throw new Error(`reconstructAgent: invocation ${invocationId} not found`);

    // Walk up just for context inheritance.
    const parentAgent = this.reconstructAgent(sub.assistantParentId);
    const Cls = this.lookupCallable(sub.toolCall.name);
    const normalized = normalizeArgs(Cls.schema.parameters, sub.toolCall.arguments);
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
      normalized as Record<string, unknown>,
      parentAgent.context,
      invocationId,
      [], // sub-agents have empty threadHistory
      this.collectToolThread(invocationId),
    );
  }

  // Returns the calling agent (reconstructed) for `agentId`, or null if
  // `agentId` is the root.
  protected findCallingAgent(agentId: string): MXAgent | null {
    const sub = this.findSubAgentToolCall(agentId);
    if (!sub) return null; // agentId is root (no enclosing AssistantMessage)
    return this.reconstructAgent(sub.assistantParentId);
  }

  // True iff the agent's most recent dispatched AssistantMessage (in its own
  // thread) has a matching ToolResultMessage for every tool_call it issued.
  // Used to gate bubble-up: a calling agent only re-runs after all its
  // outstanding sub-tasks finish.
  protected allToolCallsResolved(agentId: string): boolean {
    let lastDispatched: AssistantMessage | null = null;
    const resolvedToolCallIds = new Set<string>();
    for (const e of this.log) {
      if (e.parent_id !== agentId) continue;
      if ('role' in e && e.role === 'assistant') {
        // Track only AssistantMessages that issued tool_calls. The most
        // recent such message is the one whose results we wait for.
        if (e.content.some((c) => c.type === 'toolCall')) lastDispatched = e;
      } else if ('role' in e && e.role === 'toolResult') {
        resolvedToolCallIds.add(e.toolCallId);
      }
    }
    if (!lastDispatched) return true; // no dispatch pending; agent is fresh
    return lastDispatched.content
      .filter((c): c is ToolCall => c.type === 'toolCall')
      .every((tc) => resolvedToolCallIds.has(tc.id));
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

  // Find a sub-agent's invoking ToolCall + the AssistantMessage carrying it.
  protected findSubAgentToolCall(
    id: string,
  ): { toolCall: ToolCall; assistantParentId: string } | null {
    for (const e of this.log) {
      if (!('role' in e) || e.role !== 'assistant') continue;
      for (const block of e.content) {
        if (block.type === 'toolCall' && block.id === id) {
          if (e.parent_id == null) return null; // shouldn't happen, but defensive
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
