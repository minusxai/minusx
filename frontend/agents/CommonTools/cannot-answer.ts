import { Type, type Static } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/tool';
import type { ToolResult } from '@/orchestrator/types';

const SCHEMA = Type.Object({
  reason: Type.String({ description: 'Why the question cannot be answered' }),
});

export class CannotAnswer extends Tool<typeof SCHEMA> {
  readonly name = 'CannotAnswer';
  readonly description =
    'Signal that the question cannot be answered with the available data. Call this if the data is insufficient or the question is unanswerable.';
  readonly schema = SCHEMA;

  async run({ reason }: Static<typeof SCHEMA>): Promise<ToolResult> {
    return { state: 'success', content: { submitted: true, cannot_answer: true, reason: String(reason) } };
  }
}
