import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Tool } from './tool';
import type { RunContext } from './types';

export abstract class Agent {
  abstract readonly name: string;
  abstract tools: Tool[];
  abstract systemPrompt(ctx: RunContext): string;

  /**
   * Hard cap on the number of LLM turns per `runAgent` call. Prevents runaway
   * loops if the LLM keeps producing tool calls. Subclasses can raise/lower
   * this; `shouldStopAfterTurn` consults it as the default stop condition.
   *
   * Mirrors Python `MAX_STEPS_LOWER_LEVEL = 35` in `tasks/llm/config.py`.
   */
  maxTurns: number = 35;

  /**
   * Called by `runAgent` after each LLM turn (one streamFn call) finishes.
   * Default behavior: stop once we've taken `maxTurns` turns.
   *
   * Override for custom stop conditions (e.g. token-budget limits, eval-gate
   * conditions). Returning `true` exits the loop after the current turn
   * completes; the run returns `state: 'success'` with `truncated: true`
   * if the last turn intended further tool calls.
   */
  async shouldStopAfterTurn(turnIndex: number): Promise<boolean> {
    return turnIndex >= this.maxTurns;
  }

  buildAgentTools(ctx: RunContext): AgentTool[] {
    if (!ctx.contextArgs) {
      ctx.contextArgs = {};
    }
    return this.tools.map((t) => t.toAgentTool(ctx));
  }
}
