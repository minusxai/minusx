import { Type, type TSchema, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { RunContext } from './types';

export abstract class Tool<TArgs = unknown> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly schema: TSchema;

  abstract run(args: TArgs, ctx: RunContext): Promise<unknown>;

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
        const text = typeof result === 'string' ? result : JSON.stringify(result);
        return {
          content: [{ type: 'text' as const, text }],
          details: result,
        };
      },
    };
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
