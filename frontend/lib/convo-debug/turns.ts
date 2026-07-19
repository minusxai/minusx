/**
 * Wire messages → turn bars (the /debug viz core conversion).
 *
 * Segmentation walks the root thread's wire messages in request order:
 * - a `user` message starts an `input` bar (the FIRST one additionally gets
 *   SystemPrompt + ToolDefinitions components);
 * - an `assistant` message is one `assistant` bar;
 * - a run of consecutive `toolResult` messages is ONE `toolResults` bar with a
 *   component per result.
 *
 * `callIndex` matches how cost accrues: assistant bars carry the index of the
 * call that produced them; input/toolResults bars carry the index of the call
 * they trigger (i.e. assistant bars seen so far). Trailing input bars after
 * the last assistant therefore get lastCall+1 — the hypothetical next call.
 *
 * Sub-agent LLM calls (from the log) surface as one aggregated `SubAgentLLM`
 * component per root-level invocation, attached to the tool-result bar that
 * carries that invocation's result. Their tokens are the sub-calls' OUTPUT
 * tokens — informational; they are not part of the root wire context.
 */
import type { AssistantMessage, ToolResultMessage, UserMessage } from '@/orchestrator/llm';
import { estimateTextTokens } from './approx';
import { splitAssistantContent, splitUserContent, toolResultComponents } from './components';
import { extractActualCalls } from './actual';
import type { BarComponent, ConvoDebugInput, TurnBar } from './types';

/** A bar before cost assignment (costs.ts fills `cost`). */
export type BareTurnBar = Omit<TurnBar, 'cost'>;

function sumTokens(components: BarComponent[]): number {
  return components.reduce((s, c) => s + c.tokens, 0);
}

/** Aggregate sub-agent calls per root-level invocation → SubAgentLLM components. */
function subAgentComponents(input: ConvoDebugInput): Map<string, BarComponent> {
  const byInvocation = new Map<string, BarComponent>();
  for (const call of extractActualCalls(input.log)) {
    if (!call.isSubAgent || !call.rootToolCallId) continue;
    const existing = byInvocation.get(call.rootToolCallId);
    const outputTokens = call.usage.output;
    if (existing) {
      existing.tokens += outputTokens;
      (existing.content[0] as { value: { calls: number; outputTokens: number } }).value.calls += 1;
      (existing.content[0] as { value: { calls: number; outputTokens: number } }).value.outputTokens += outputTokens;
    } else {
      byInvocation.set(call.rootToolCallId, {
        type: 'SubAgentLLM',
        toolName: call.rootToolName,
        toolCallId: call.rootToolCallId,
        tokens: outputTokens,
        imageTokens: 0,
        chars: 0,
        imageCount: 0,
        content: [{ kind: 'json', value: { tool: call.rootToolName, calls: 1, outputTokens } }],
      });
    }
  }
  return byInvocation;
}

export function buildTurnBars(input: ConvoDebugInput): BareTurnBar[] {
  const bars: BareTurnBar[] = [];
  const subAgents = subAgentComponents(input);
  let callIndex = 0;
  let userTurn = 0;

  const pushBar = (bar: Omit<BareTurnBar, 'index' | 'tokens'>): void => {
    bars.push({ ...bar, index: bars.length, tokens: sumTokens(bar.components) });
  };

  let i = 0;
  while (i < input.messages.length) {
    const msg = input.messages[i];
    if (msg.role === 'user') {
      userTurn += 1;
      const components: BarComponent[] = [];
      if (bars.length === 0) {
        if (input.systemPrompt) {
          components.push({
            type: 'SystemPrompt',
            tokens: estimateTextTokens(input.systemPrompt),
            imageTokens: 0,
            chars: input.systemPrompt.length,
            imageCount: 0,
            content: [{ kind: 'text', text: input.systemPrompt }],
          });
        }
        if (input.toolDefsChars > 0) {
          components.push({
            type: 'ToolDefinitions',
            tokens: Math.ceil(input.toolDefsChars / 4),
            imageTokens: 0,
            chars: input.toolDefsChars,
            imageCount: 0,
            content: [{ kind: 'text', text: `(tool definitions, ${input.toolDefsChars} chars)` }],
          });
        }
      }
      components.push(...splitUserContent((msg as UserMessage).content));
      pushBar({
        type: 'input',
        label: bars.length === 0 ? `System + User #${userTurn}` : `User #${userTurn}`,
        components,
        callIndex,
      });
      i += 1;
    } else if (msg.role === 'assistant') {
      pushBar({
        type: 'assistant',
        label: `Assistant (call ${callIndex + 1})`,
        components: splitAssistantContent(msg as AssistantMessage),
        callIndex,
      });
      callIndex += 1;
      i += 1;
    } else {
      // Merge the run of consecutive tool results into one bar.
      const run: ToolResultMessage[] = [];
      while (i < input.messages.length && input.messages[i].role === 'toolResult') {
        run.push(input.messages[i] as ToolResultMessage);
        i += 1;
      }
      const components = toolResultComponents(run);
      for (const r of run) {
        const sub = subAgents.get(r.toolCallId);
        if (sub) components.push(sub);
      }
      pushBar({
        type: 'toolResults',
        label: `Tool results (call ${callIndex + 1})`,
        components,
        callIndex,
      });
    }
  }
  return bars;
}
