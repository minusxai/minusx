import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/src/tool';
import type { ToolResult } from '@/orchestrator/src/types';

interface Args {
  answer: number;
}

export class SubmitNumber extends Tool<Args> {
  readonly name = 'SubmitNumber';
  readonly description =
    'Submit a numeric answer for a number_match eval assertion. Use this tool when asked to compute and submit a numeric value during evaluation. Call this exactly once with your final computed answer.';
  readonly schema = Type.Object({
    answer: Type.Number({ description: 'Numeric answer to the eval question' }),
  });

  async run({ answer }: Args): Promise<ToolResult> {
    return { state: 'success', content: { submitted: true, answer: Number(answer) } };
  }
}
