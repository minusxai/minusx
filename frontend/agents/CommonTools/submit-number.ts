import { Type, type Static } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/tool';
import type { ToolResult } from '@/orchestrator/types';

const SCHEMA = Type.Object({
  answer: Type.Number({ description: 'Numeric answer to the eval question' }),
});

export class SubmitNumber extends Tool<typeof SCHEMA> {
  readonly name = 'SubmitNumber';
  readonly description =
    'Submit a numeric answer for a number_match eval assertion. Use this tool when asked to compute and submit a numeric value during evaluation. Call this exactly once with your final computed answer.';
  readonly schema = SCHEMA;

  async run({ answer }: Static<typeof SCHEMA>): Promise<ToolResult> {
    return { state: 'success', content: { submitted: true, answer: Number(answer) } };
  }
}
