import { Type, type Static } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/tool';
import type { ToolResult } from '@/orchestrator/types';

const SCHEMA = Type.Object({
  content: Type.Optional(Type.String()),
  citations: Type.Optional(Type.Array(Type.Any())),
  content_blocks: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
});

export class TalkToUser extends Tool<typeof SCHEMA> {
  readonly name = 'TalkToUser';
  readonly description = 'Send a message to the user.';
  readonly schema = SCHEMA;

  async run({ content = '', citations = [], content_blocks = [] }: Static<typeof SCHEMA>): Promise<ToolResult> {
    if (content_blocks.length > 0) {
      return { state: 'success', content: { content_blocks } };
    }
    return { state: 'success', content: { content, citations } };
  }
}
