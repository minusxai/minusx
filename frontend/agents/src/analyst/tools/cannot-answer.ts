import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/src/tool';
import type { ToolResult } from '@/orchestrator/src/types';

interface Args {
  reason: string;
}

export class CannotAnswer extends Tool<Args> {
  readonly name = 'CannotAnswer';
  readonly description =
    'Signal that the question cannot be answered with the available data. Call this if the data is insufficient or the question is unanswerable.';
  readonly schema = Type.Object({
    reason: Type.String({ description: 'Why the question cannot be answered' }),
  });

  async run({ reason }: Args): Promise<ToolResult> {
    return { state: 'success', content: { submitted: true, cannot_answer: true, reason: String(reason) } };
  }
}
