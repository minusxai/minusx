import { agentLoop } from '@mariozechner/pi-agent-core';
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
} from '@mariozechner/pi-agent-core';
import type { AssistantMessage, Model, Message } from '@mariozechner/pi-ai';
import type { Agent } from './agent';
import {
  CompressedConversationLog,
  CompressedTask,
  type ConversationLogEntry,
  getLatestRootTask,
} from './conversation';
import { buildMessagesFromLog, userMessageArgs } from './log-messages';
import type { RunContext } from './types';
import { generateId } from './utils';

export interface RunAgentResult {
  logDiff: ConversationLogEntry[];
  finalContent: string;
}

export type LoopFn = (
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
) => AsyncIterable<AgentEvent>;

export async function runAgent(
  agent: Agent,
  userMessage: string | null,
  existingLog: ConversationLogEntry[],
  ctx: RunContext,
  loopFn: LoopFn = agentLoop as unknown as LoopFn,
): Promise<RunAgentResult> {
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

  const agentTools: AgentTool[] = agent.buildAgentTools(ctx);

  // Reconstruct prior LLM history from the existing log so multi-turn works.
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

    afterToolCall: async ({ toolCall, result, isError }) => {
      const resultValue = isError
        ? (result.content[0]?.type === 'text' ? result.content[0].text : 'error')
        : (result.details ?? (result.content[0]?.type === 'text' ? result.content[0].text : null));
      log.assignResult(toolCall.id, resultValue);
      return undefined;
    },

    shouldStopAfterTurn: async () => {
      currentBatchRunId = generateId();
      return false;
    },
  };

  let finalContent = '';

  const stream = loopFn(prompts, agentContext, config, ctx.signal);
  for await (const event of stream) {
    if (event.type === 'agent_end') {
      const msgs = event.messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        if (msg.role === 'assistant') {
          const assistantMsg = msg as AssistantMessage;
          const textBlock = assistantMsg.content.find((c) => c.type === 'text');
          if (textBlock && textBlock.type === 'text') {
            finalContent = textBlock.text;
          }
          break;
        }
      }
    }
  }

  log.assignResult(rootTaskId, finalContent || 'done');

  return {
    logDiff: log.getLogDiff(),
    finalContent,
  };
}
