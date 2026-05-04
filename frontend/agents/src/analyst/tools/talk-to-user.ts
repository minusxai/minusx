import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/src/tool';
import type { ToolResult } from '@/orchestrator/src/types';

interface Args {
  content?: string;
  citations?: unknown[];
  content_blocks?: Record<string, unknown>[];
}

export class TalkToUser extends Tool<Args> {
  readonly name = 'TalkToUser';
  readonly description = 'Send a message to the user.';
  readonly schema = Type.Object({
    content: Type.Optional(Type.String()),
    citations: Type.Optional(Type.Array(Type.Any())),
    content_blocks: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
  });

  async run({ content = '', citations = [], content_blocks = [] }: Args): Promise<ToolResult> {
    if (content_blocks.length > 0) {
      return { state: 'success', content: { content_blocks } };
    }
    return { state: 'success', content: { content, citations } };
  }
}
