import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/src/tool';
import type { ToolResult } from '@/orchestrator/src/types';

interface Args {
  answer: string;
}

export class SubmitString extends Tool<Args> {
  readonly name = 'SubmitString';
  readonly description =
    'Submit a string answer for a string_match eval assertion. Use this tool when asked to compute and submit a string value during evaluation. Call this exactly once with your final string answer.';
  readonly schema = Type.Object({
    answer: Type.String({ description: 'String answer to the eval question' }),
  });

  async run({ answer }: Args): Promise<ToolResult> {
    return { state: 'success', content: { submitted: true, answer: String(answer) } };
  }
}
