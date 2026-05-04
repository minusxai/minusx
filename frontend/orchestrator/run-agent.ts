import { agentLoop } from '@mariozechner/pi-agent-core';
import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  StreamFn,
} from '@mariozechner/pi-agent-core';
import type { AssistantMessage, Model, Message } from '@mariozechner/pi-ai';
import type { Agent } from './agent';
import {
  CompressedConversationLog,
  CompressedTask,
  type ConversationLogEntry,
  type LLMDebug,
  getLatestRootTask,
} from './conversation';
import { buildMessagesFromLog, userMessageArgs } from './log-messages';
import type { AgentResult, PendingToolCall, RunContext, ToolResult } from './types';
import { generateId } from './utils';

export async function runAgent(
  agent: Agent,
  userMessage: string | null,
  existingLog: ConversationLogEntry[],
  ctx: RunContext,
  /**
   * Optional override of the LLM stream function (the inner-most call agentLoop
   * makes to the model). Tests pass a mock streamFn; production omits this and
   * the real provider streamSimple is used.
   */
  streamFn?: StreamFn,
): Promise<AgentResult> {
  const log = new CompressedConversationLog(existingLog);

  const latestRoot = getLatestRootTask(existingLog);
  const rootTaskId = generateId();

  const rootTask = new CompressedTask({
    unique_id: rootTaskId,
    parent_unique_id: null,
    previous_unique_id: latestRoot?.unique_id ?? null,
    run_id: generateId(),
    agent: agent.name,
    args: userMessageArgs(userMessage),
  });
  log.addTask(rootTask);

  // Each LLM tool-use turn gets its own run_id; resets in shouldStopAfterTurn.
  let currentBatchRunId = generateId();

  // Tools that returned `state: 'pending'` during this run. Their tasks have no
  // result; the caller (route.ts) returns them as pending_tool_calls and the next
  // POST resumes by injecting actual results.
  const pendingTools: PendingToolCall[] = [];

  // Track turn count + last stopReason so we can compute `truncated` and let the
  // agent's shouldStopAfterTurn enforce its turn budget (default: agent.maxTurns).
  let turnIndex = 0;
  let lastStopReason: AssistantMessage['stopReason'] | undefined;
  let stoppedByAgent = false;

  // Per-turn LLM stats accumulated from `message_end` events. Written to a
  // TaskDebugLog entry at the end so callers (admin debug UI, eval harnesses,
  // cost reporting) can see what each LLM call cost. Mirrors Python's LLMDebug.
  const llmDebug: LLMDebug[] = [];
  const turnStartTimes: number[] = [];
  const runStart = Date.now();

  const agentTools: AgentTool[] = agent.buildAgentTools(ctx);
  const priorMessages = buildMessagesFromLog(existingLog);

  const agentContext: AgentContext = {
    systemPrompt: agent.systemPrompt(ctx),
    messages: priorMessages,
    tools: agentTools,
  };

  const prompts: AgentMessage[] = [];
  if (userMessage) {
    prompts.push({
      role: 'user',
      content: [{ type: 'text', text: userMessage }],
      timestamp: Date.now(),
    });
  }

  const config: AgentLoopConfig = {
    model: (ctx.model ?? {}) as Model<any>,
    convertToLlm: (messages: AgentMessage[]): Message[] => messages as Message[],

    beforeToolCall: async ({ toolCall, args }) => {
      const childTask = new CompressedTask({
        unique_id: toolCall.id,
        parent_unique_id: rootTaskId,
        previous_unique_id: null,
        run_id: currentBatchRunId,
        agent: toolCall.name,
        args: args as Record<string, unknown>,
      });
      log.addTask(childTask);

      const parent = log.tasks.get(rootTaskId);
      if (parent) {
        let placed = false;
        for (const batch of parent.child_unique_ids) {
          const firstTask = log.tasks.get(batch[0]);
          if (firstTask && firstTask.run_id === currentBatchRunId) {
            batch.push(toolCall.id);
            placed = true;
            break;
          }
        }
        if (!placed) {
          parent.child_unique_ids.push([toolCall.id]);
        }
      }

      return undefined;
    },

    afterToolCall: async ({ toolCall, args, result }) => {
      // Tools always return a typed ToolResult on `details`. Dispatch on state.
      const tr = result.details as ToolResult | undefined;
      if (!tr || typeof tr !== 'object' || !('state' in tr)) {
        // Defensive: a tool that didn't go through Tool.toAgentTool() — fall back
        // to using whatever text content the tool emitted.
        const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
        log.assignResult(toolCall.id, text);
        return undefined;
      }

      switch (tr.state) {
        case 'success':
          log.assignResult(toolCall.id, tr.content);
          return undefined;

        case 'failure':
          // Record the failure in the log and tell agentLoop this is an error so
          // the LLM sees it as a tool_error message and can adjust its plan.
          log.assignResult(toolCall.id, { error: tr.error });
          return { isError: true };

        case 'pending':
          // Don't write a result — the task stays pending in the log. Track it
          // for runAgent's return value, then terminate the loop.
          pendingTools.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: args as Record<string, unknown>,
            pending: tr.pending,
          });
          return { terminate: true };
      }
    },

    shouldStopAfterTurn: async ({ message }) => {
      currentBatchRunId = generateId();
      turnIndex += 1;
      lastStopReason = message.stopReason;
      const stop = await agent.shouldStopAfterTurn(turnIndex);
      if (stop) stoppedByAgent = true;
      return stop;
    },
  };

  let finalContent = '';
  let agentLoopError: string | undefined;

  const stream = agentLoop(prompts, agentContext, config, ctx.signal, streamFn);
  for await (const event of stream) {
    // Per-LLM-turn debug capture. message_start fires once per LLM call (start of
    // streaming); message_end fires when the assistant message is complete.
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      turnStartTimes.push(Date.now());
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const m = event.message as AssistantMessage;
      const startedAt = turnStartTimes[turnStartTimes.length - 1] ?? Date.now();
      llmDebug.push({
        model: m.model,
        responseId: m.responseId,
        duration: (Date.now() - startedAt) / 1000,
        finishReason: m.stopReason,
        promptTokens: m.usage.input,
        completionTokens: m.usage.output,
        totalTokens: m.usage.totalTokens,
        cacheReadTokens: m.usage.cacheRead,
        cacheWriteTokens: m.usage.cacheWrite,
        cost: m.usage.cost?.total ?? 0,
      });
    }
    if (event.type === 'agent_end') {
      const msgs = event.messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        if (msg.role === 'assistant') {
          const assistantMsg = msg as AssistantMessage;
          if (assistantMsg.stopReason === 'error' || assistantMsg.stopReason === 'aborted') {
            agentLoopError = assistantMsg.errorMessage ?? `agent ${assistantMsg.stopReason}`;
          }
          const textBlock = assistantMsg.content.find((c) => c.type === 'text');
          if (textBlock && textBlock.type === 'text') {
            finalContent = textBlock.text;
          }
          break;
        }
      }
    }
  }

  // Append per-task debug entry. One per runAgent call, attached to the root task.
  const totalDuration = (Date.now() - runStart) / 1000;
  log.addDebug(rootTaskId, totalDuration, llmDebug);

  // Distinguish the three terminal states for the caller.
  if (pendingTools.length > 0) {
    // Don't assign a root TaskResult — the agent isn't done; it's paused.
    return {
      state: 'pending',
      pendingTools,
      logDiff: log.getLogDiff(),
    };
  }

  if (agentLoopError) {
    log.assignResult(rootTaskId, { error: agentLoopError });
    return {
      state: 'failure',
      error: agentLoopError,
      logDiff: log.getLogDiff(),
    };
  }

  // Truncated = the response is incomplete because something cut us short:
  //   - LLM hit its max output token budget (`length`), OR
  //   - agent.shouldStopAfterTurn returned true while the LLM still wanted to
  //     call more tools (`toolUse`). Typically this is `maxTurns` reached.
  const truncated =
    lastStopReason === 'length' || (stoppedByAgent && lastStopReason === 'toolUse');

  log.assignResult(rootTaskId, finalContent || 'done');
  return {
    state: 'success',
    content: finalContent,
    truncated,
    logDiff: log.getLogDiff(),
  };
}
