import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Tool } from './tool';
import type { RunContext } from './types';

export abstract class Agent {
  abstract readonly name: string;
  abstract tools: Tool[];
  abstract systemPrompt(ctx: RunContext): string;

  buildAgentTools(ctx: RunContext): AgentTool[] {
    if (!ctx.contextArgs) {
      ctx.contextArgs = {};
    }
    return this.tools.map((t) => t.toAgentTool(ctx));
  }
}
