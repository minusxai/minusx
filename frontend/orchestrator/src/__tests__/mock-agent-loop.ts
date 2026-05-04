import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
} from '@mariozechner/pi-agent-core';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import type { LoopFn } from '../run-agent';
import { generateId } from '../utils';

export interface MockToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface MockTurn {
  toolCalls?: MockToolCall[];
  reply?: string;
}

export class MockAgentLoop {
  private turns: MockTurn[] = [];

  configure(turns: MockTurn[]): void {
    this.turns = turns;
  }

  asLoopFn(): LoopFn {
    const turns = this.turns;

    return async function* (
      prompts: AgentMessage[],
      context: AgentContext,
      config: AgentLoopConfig,
      signal?: AbortSignal,
    ): AsyncGenerator<AgentEvent> {
      const allMessages: AgentMessage[] = [...context.messages, ...prompts];

      yield { type: 'agent_start' };

      for (const turn of turns) {
        if (signal?.aborted) break;

        yield { type: 'turn_start' };

        // Build tool call content blocks
        const toolCallBlocks = (turn.toolCalls ?? []).map((tc) => ({
          type: 'toolCall' as const,
          id: generateId(),
          name: tc.name,
          arguments: tc.args,
        }));

        const contentBlocks: AssistantMessage['content'] = [];
        if (turn.reply) {
          contentBlocks.push({ type: 'text', text: turn.reply });
        }
        contentBlocks.push(...toolCallBlocks);

        const assistantMessage: AssistantMessage = {
          role: 'assistant',
          content: contentBlocks,
          api: 'openai-completions',
          provider: 'openai',
          model: 'mock',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: toolCallBlocks.length > 0 ? 'toolUse' : 'stop',
          timestamp: Date.now(),
        };

        yield { type: 'message_start', message: assistantMessage };
        yield { type: 'message_end', message: assistantMessage };
        allMessages.push(assistantMessage);

        // Execute tool calls
        const toolResults: import('@mariozechner/pi-ai').ToolResultMessage[] = [];

        for (const tc of toolCallBlocks) {
          // Find the tool in context
          const tool = context.tools?.find((t) => t.name === tc.name);

          // Build BeforeToolCallContext
          const agentCtx = { systemPrompt: context.systemPrompt, messages: allMessages, tools: context.tools };
          const beforeCtx = {
            assistantMessage,
            toolCall: tc,
            args: tc.arguments,
            context: agentCtx,
          };

          // Call beforeToolCall hook
          await config.beforeToolCall?.(beforeCtx as any, signal);

          // Execute tool
          let result: { content: { type: 'text'; text: string }[]; details: unknown };
          let isError = false;
          try {
            if (!tool) {
              throw new Error(`Tool not found: ${tc.name}`);
            }
            const toolResult = await tool.execute(tc.id, tc.arguments as any, signal);
            result = {
              content: toolResult.content.map((c) =>
                c.type === 'text' ? { type: 'text' as const, text: c.text } : { type: 'text' as const, text: '' },
              ),
              details: toolResult.details,
            };
          } catch (err) {
            isError = true;
            result = {
              content: [{ type: 'text', text: String(err) }],
              details: null,
            };
          }

          // Call afterToolCall hook
          const afterCtx = {
            assistantMessage,
            toolCall: tc,
            args: tc.arguments,
            result: { content: result.content, details: result.details },
            isError,
            context: agentCtx,
          };
          const afterOverride = await config.afterToolCall?.(afterCtx as any, signal);
          if (afterOverride) {
            if (afterOverride.content !== undefined) result.content = afterOverride.content as any;
            if (afterOverride.details !== undefined) result.details = afterOverride.details;
            if (afterOverride.isError !== undefined) isError = afterOverride.isError;
          }

          const toolResultMsg: import('@mariozechner/pi-ai').ToolResultMessage = {
            role: 'toolResult',
            toolCallId: tc.id,
            toolName: tc.name,
            content: result.content,
            details: result.details,
            isError,
            timestamp: Date.now(),
          };

          toolResults.push(toolResultMsg);
          allMessages.push(toolResultMsg);
        }

        // Call shouldStopAfterTurn
        const shouldStopCtx = {
          message: assistantMessage,
          toolResults,
          context: { systemPrompt: context.systemPrompt, messages: allMessages, tools: context.tools },
          newMessages: allMessages,
        };
        const shouldStop = await config.shouldStopAfterTurn?.(shouldStopCtx as any);

        yield { type: 'turn_end', message: assistantMessage, toolResults };

        if (shouldStop) break;
      }

      yield { type: 'agent_end', messages: allMessages };
    };
  }
}
