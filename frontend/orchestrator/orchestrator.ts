
import { randomUUID } from 'crypto';
import {
  EventStream,
  streamSimple,
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
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
  type MXAgentDetails,
  type PendingToolCall,
  type RegistrableClass,
  type StreamEvent,
  type ToolMessage,
  type ToolResponse,
} from './types';
import { normalizeParameters, synthErrorAssistantMessage, validateParameters } from './utils';
import { createSemaphore, parseConcurrencyLimit } from './concurrency';

// Optional process-wide cap on concurrent LLM calls. Set via the
// `MAX_LLM_CONCURRENCY` env var (read once at module load). Used by
// batch callers (benchmarks) to keep total in-flight provider requests
// below provider RPM ceilings. No-op when unset or non-positive.
// Module-level so every Orchestrator instance in this process shares
// the same budget.
const llmSemaphore = createSemaphore(
  // eslint-disable-next-line no-restricted-syntax -- orchestrator is a standalone module; avoid coupling to lib/config for one optional batch-runner override
  parseConcurrencyLimit(process.env.MAX_LLM_CONCURRENCY),
);

export class Orchestrator {
  log: ConversationLog;
  protected stream: EventStream<StreamEvent, AssistantMessage | null> | null = null;
  protected controller: AbortController | null = null;
  protected readonly registrables: RegistrableClass[];
  protected used = false;

  constructor(registrables: RegistrableClass[], log?: ConversationLog) {
    this.registrables = registrables;
    this.log = log ?? [];
  }

  get signal(): AbortSignal | undefined {
    return this.controller?.signal;
  }

  cancel(): void {
    this.controller?.abort();
  }

  getPendingToolCalls(): PendingToolCall[] {
    const allCalls = new Map<string, { name: string; parameters: Record<string, unknown>; parent_id: string }>();
    const resolved = new Set<string>();
    for (const e of this.log) {
      if ('role' in e && e.role === 'assistant') {
        if (e.parent_id == null) continue;
        for (const c of e.content) {
          if (c.type === 'toolCall') {
            allCalls.set(c.id, { name: c.name, parameters: c.arguments, parent_id: e.parent_id });
          }
        }
      } else if ('role' in e && e.role === 'toolResult') {
        resolved.add(e.toolCallId);
      }
    }
    const out: PendingToolCall[] = [];
    for (const [id, info] of allCalls) {
      if (resolved.has(id)) continue;
      out.push({
        id,
        name: info.name,
        parameters: info.parameters,
        context: this.contextForAgent(info.parent_id),
        parent_id: info.parent_id,
      });
    }
    return out;
  }

  protected contextForAgent(agentId: string): AgentContext {
    let current = agentId;
    while (true) {
      const root = this.findRootInvocation(current);
      if (root) return root.context;
      const sub = this.findSubAgentToolCall(current);
      if (!sub) throw new Error(`contextForAgent: no invocation for ${current}`);
      current = sub.assistantParentId;
    }
  }

  async callLLM(
    model: Model<Api>,
    context: Context,
    agentId: string,
    callOptions?: Record<string, unknown>,
  ): Promise<AssistantMessage> {
    const callId = randomUUID();
    const t0 = Date.now();

    // Optional global LLM-concurrency cap (MAX_LLM_CONCURRENCY env). No-op
    // when unset, so production code paths are unaffected. Acquire before
    // dispatching the request so queued calls don't materialize provider
    // sockets until they have a slot.
    await llmSemaphore.acquire();
    try {
      // Spread `callOptions` blindly into pi-ai's stream options. We treat it
      // as an opaque blob (`SimpleStreamOptions`-shaped) so adding new pi-ai
      // options (`thinkingBudgets`, `metadata`, …) never touches this code.
      const piStream = streamSimple(model, context, {
        ...(callOptions ?? {}),
        headers: {
          ...((callOptions?.headers as Record<string, string> | undefined) ?? {}),
          'X-MX-Request-Call-ID': callId,
        },
        signal: this.controller?.signal,
      });

      let result: AssistantMessage | null = null;
      let errored = false;
      try {
        for await (const ev of piStream) {
          this.stream?.push({ ...ev, parent_id: agentId });
          if (ev.type === 'done') result = ev.message;
          else if (ev.type === 'error') {
            result = ev.error;
            errored = true;
          }
        }
      } finally {
        if (result) {
          const durationSec = (Date.now() - t0) / 1000;
          const firstTool = result.content?.find((c: unknown) => (c as { type?: string }).type === 'toolCall') as Record<string, unknown> | undefined;
          const target = firstTool ?? (result as unknown as Record<string, unknown>);
          target['_duration'] = durationSec;
          target['_lllmCallId'] = callId;
        }
      }
      if (!result) {
        throw new Error(`callLLM: pi-ai stream ended without done/error event (agent=${agentId})`);
      }
      if (errored) {
        throw new Error(
          `callLLM: pi-ai stream errored (agent=${agentId}, reason='${result.stopReason}'): ${result.errorMessage ?? ''}`,
        );
      }
      return result;
    } finally {
      llmSemaphore.release();
    }
  }

  run(root: MXAgent): EventStream<StreamEvent, AssistantMessage | null> {
    if (this.used) {
      throw new Error('Orchestrator is single-use: this instance already executed run() or resume(). Construct a fresh Orchestrator with the saved log.');
    }
    this.used = true;
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
          // No-op: per-tool pending events were already emitted at the source
          // (in dispatch). UIE just signals "the run paused".
        } else {
          stream.push(this.synthErrorEvent(root.id, err));
        }
      } finally {
        stream.end(result);
      }
    })();

    return stream;
  }

  resume(completed: ToolResultMessage[]): EventStream<StreamEvent, AssistantMessage | null> {
    if (this.used) {
      throw new Error('Orchestrator is single-use: this instance already executed run() or resume(). Construct a fresh Orchestrator with the saved log.');
    }
    this.used = true;
    this.controller = new AbortController();

    const byPausedAgent = new Map<string, ToolResultMessage[]>();
    for (const trm of completed) {
      let parent_id: string | null = null;
      for (const e of this.log) {
        if (!('role' in e) || e.role !== 'assistant') continue;
        for (const block of e.content) {
          if (block.type === 'toolCall' && block.id === trm.toolCallId) {
            parent_id = e.parent_id;
            break;
          }
        }
        if (parent_id) break;
      }
      if (parent_id == null) {
        throw new Error(`resume: no parent_id found for toolCallId ${trm.toolCallId}`);
      }
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
      const ids = Array.from(byPausedAgent.keys());
      const settled = await Promise.allSettled(
        ids.map((id) => resumeChain(id, this.findCallingAgent(id))),
      );

      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === 'fulfilled') {
          if (r.value !== null) rootResult = r.value;
        } else if (r.reason instanceof UserInputException) {
          // No-op: per-tool pending events already emitted at the source.
        } else {
          stream.push(this.synthErrorEvent(ids[i], r.reason));
        }
      }
      stream.end(rootResult);
    })();

    return stream;
  }

  async dispatch(
    message: AssistantMessage,
    parent: MXAgent,
    opts?: { threadHistoryByToolCallId?: Record<string, Message[]> },
  ): Promise<void> {
    this.log.push({ ...message, parent_id: parent.id });
    parent.toolThread.push(message);

    const toolCalls = message.content.filter((c): c is ToolCall => c.type === 'toolCall');
    if (toolCalls.length === 0) return;

    const settled = await Promise.allSettled(
      toolCalls.map(async (tc) => {
        let Cls: RegistrableClass;
        try {
          Cls = this.lookupCallable(tc.name);
        } catch {
          const available = ((parent.constructor as typeof MXAgent).tools ?? [])
            .map((t) => t.name)
            .join(', ');
          const trm: ToolResultMessage = {
            role: 'toolResult',
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{
              type: 'text',
              text: `Unknown tool '${tc.name}'. Available tools: ${available || '(none)'}.`,
            }],
            isError: true,
            timestamp: Date.now(),
          };
          this.log.push({ ...trm, parent_id: parent.id });
          parent.toolThread.push(trm);
          return;
        }

        const validation = validateParameters(Cls.schema.parameters, tc.arguments);
        if (!validation.ok) {
          const trm: ToolResultMessage = {
            role: 'toolResult',
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{
              type: 'text',
              text: `Invalid parameters for '${tc.name}': ${validation.errors.join('; ')}`,
            }],
            isError: true,
            timestamp: Date.now(),
          };
          this.log.push({ ...trm, parent_id: parent.id });
          parent.toolThread.push(trm);
          return;
        }

        const instance = this.instantiate(
          Cls,
          validation.value as Record<string, unknown>,
          parent.context,
          tc.id,
          opts?.threadHistoryByToolCallId?.[tc.id],
        );

        if (instance instanceof MXAgent) {
          // Sub-agent: any UIE inside it has already emitted its own per-tool
          // pending events at the deepest level (this same code path, leaf
          // branch). The bubble-up shouldn't re-emit.
          const subFinal = await instance.run();
          this.appendAgentResult(subFinal, instance, parent);
          return;
        }

        try {
          const response = (await instance.run()) as ToolResponse;
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
        } catch (err) {
          if (err instanceof UserInputException) {
            // Frontend-bridge tool: emit a `pending` event and re-throw so
            // the orchestrator pauses for the bridge to fulfil this tool.
            this.stream?.push({
              type: 'pending',
              id: tc.id,
              name: tc.name,
              parameters: instance.parameters as Record<string, unknown>,
              context: parent.context,
              parent_id: parent.id,
            });
            throw err;
          }
          // Server-side tool that threw a real error (e.g. SQL connection
          // missing, network failure, etc.). Emit an `isError: true`
          // toolResult so the agent sees the error and can recover, AND so
          // the tool isn't misreported as "pending" — without this, the
          // unmatched toolCall makes `getPendingToolCalls()` return the
          // failing tool, and the frontend then tries to bridge a
          // server-side tool ("Unknown client-side tool: ExecuteSQL").
          const errorMsg = err instanceof Error ? err.message : String(err);
          const errTrm: ToolResultMessage = {
            role: 'toolResult',
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: 'text', text: `Tool execution error: ${errorMsg}` }],
            isError: true,
            timestamp: Date.now(),
          };
          this.log.push({ ...errTrm, parent_id: parent.id });
          parent.toolThread.push(errTrm);
        }
      }),
    );

    const pending: string[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') continue;
      if (r.reason instanceof UserInputException) pending.push(...r.reason.toolCallIds);
      else throw r.reason;
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
    const trm: ToolResultMessage<MXAgentDetails> = {
      role: 'toolResult',
      toolCallId: agent.id,
      toolName: ctor.schema.name,
      content: msg.content.filter((c): c is TextContent => c.type === 'text'),
      isError: msg.stopReason === 'error',
      details: { type: 'mx_agent', assistantMessage: msg },
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
    parameters: Record<string, unknown>,
    ctx: AgentContext,
    id: string,
    threadHistory?: Message[],
    toolThread?: ToolMessage[],
  ): MXTool {
    return new Cls(this, normalizeParameters(Cls.schema.parameters, parameters), ctx, id, threadHistory, toolThread);
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

  /**
   * Build a `Message[]` snapshot of a completed agent invocation, suitable
   * for seeding another agent's `threadHistory`. Combines the invocation's
   * original user message (from its toolCall arguments) with everything
   * appended under it (`collectToolThread`). Works for both root
   * invocations (top-level `AgentInvocation` log entries) and sub-agent
   * invocations (toolCall blocks inside a parent's assistant message).
   *
   * For sub-agent invocations, the final `stopReason: 'stop'` turn is
   * NOT in the log under the sub-agent's id — `appendAgentResult` wraps
   * it as a `ToolResultMessage` under the calling agent and stashes the
   * original assistant message in `details.assistantMessage`. We splice
   * it back in here so the returned history is complete. Root
   * invocations don't need this — their final turn is already pushed
   * under the root's id by `appendAgentResult`'s null-parent branch.
   *
   * Used by controller-style agents (e.g. `DoubleCheckBenchmarkAgent`) to
   * give a round-2 sub-agent the full prior round-1 reasoning trace —
   * including its tool calls and results — rather than re-running it
   * from scratch on a feedback prompt alone.
   */
  extractAgentHistory(invocationId: string): Message[] {
    const root = this.findRootInvocation(invocationId);
    const args =
      root?.arguments ?? this.findSubAgentToolCall(invocationId)?.toolCall.arguments;
    if (!args) {
      throw new Error(`extractAgentHistory: invocation '${invocationId}' not found`);
    }
    const userMsg: Message = {
      role: 'user',
      content: ((args as { userMessage?: string }).userMessage ?? '') as string,
      timestamp: Date.now(),
    };
    const thread: Message[] = [...this.collectToolThread(invocationId)];
    if (!root) {
      for (const e of this.log) {
        if (!('role' in e) || e.role !== 'toolResult') continue;
        if ((e as ToolResultMessage).toolCallId !== invocationId) continue;
        const details = (e as ToolResultMessage).details as MXAgentDetails | undefined;
        if (details?.type === 'mx_agent') thread.push(details.assistantMessage);
        break;
      }
    }
    return [userMsg, ...thread];
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
