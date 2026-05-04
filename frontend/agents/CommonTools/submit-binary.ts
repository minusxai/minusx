import { Type, type Static } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/tool';
import type { ToolResult } from '@/orchestrator/types';

const SCHEMA = Type.Object({
  answer: Type.Boolean({ description: 'True for yes/correct, False for no/incorrect' }),
});

export class SubmitBinary extends Tool<typeof SCHEMA> {
  readonly name = 'SubmitBinary';
  readonly description =
    'Submit a binary (yes/no) answer for an eval assertion. Use this tool when asked to answer a binary question during evaluation. Call this exactly once with your final answer.';
  readonly schema = SCHEMA;

  async run({ answer }: Static<typeof SCHEMA>): Promise<ToolResult> {
    return { state: 'success', content: { submitted: true, answer: Boolean(answer) } };
  }
}
