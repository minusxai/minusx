import { Type, type TSchema, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { RunContext, ToolResult } from './types';

export abstract class Tool<TArgs = unknown> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly schema: TSchema;

  abstract run(args: TArgs, ctx: RunContext): Promise<ToolResult>;

  toAgentTool(ctx: RunContext): AgentTool {
    const llmSchema = stripUnderscoreProps(this.schema);
    return {
      name: this.name,
      label: this.name,
      description: this.description,
      parameters: llmSchema,
      execute: async (_id: string, params: Static<typeof llmSchema>) => {
        const allArgs = { ...(params as Record<string, unknown>), ...(ctx.contextArgs ?? {}) };
        const result = await this.run(allArgs as TArgs, ctx);
        return {
          // Strip `state` from LLM-facing content; the discriminator is an internal
          // contract, not something the model needs to see. `details` carries the full
          // ToolResult so the orchestrator's afterToolCall hook can dispatch on state.
          content: [{ type: 'text' as const, text: toolResultToLLMText(result) }],
          details: result,
        };
      },
    };
  }
}

/** Render a ToolResult as the text the LLM sees in the tool result message. */
export function toolResultToLLMText(result: ToolResult): string {
  switch (result.state) {
    case 'success':
      return typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    case 'failure':
      return JSON.stringify({ error: result.error });
    case 'pending':
      // Pending results never appear in LLM history (the loop terminates), but we
      // still serialize defensively in case afterToolCall does emit them.
      return JSON.stringify(result.pending);
  }
}

export function stripUnderscoreProps(schema: TSchema): TSchema {
  if (schema.type !== 'object' || !schema.properties) {
    return schema;
  }

  const filteredProperties: Record<string, TSchema> = {};
  const filteredRequired: string[] = [];

  for (const [key, value] of Object.entries(schema.properties as Record<string, TSchema>)) {
    if (!key.startsWith('_')) {
      filteredProperties[key] = value;
    }
  }

  if (Array.isArray(schema.required)) {
    for (const key of schema.required as string[]) {
      if (!key.startsWith('_')) {
        filteredRequired.push(key);
      }
    }
  }

  const stripped = Type.Object(filteredProperties);
  if (filteredRequired.length > 0) {
    (stripped as Record<string, unknown>).required = filteredRequired;
  }

  return stripped;
}
