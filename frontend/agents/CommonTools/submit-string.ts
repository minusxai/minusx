import { Type, type Static } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/tool';
import type { ToolResult } from '@/orchestrator/types';

const SCHEMA = Type.Object({
  answer: Type.String({ description: 'String answer to the eval question' }),
});

export class SubmitString extends Tool<typeof SCHEMA> {
  readonly name = 'SubmitString';
  readonly description =
    'Submit a string answer for a string_match eval assertion. Use this tool when asked to compute and submit a string value during evaluation. Call this exactly once with your final string answer.';
  readonly schema = SCHEMA;

  async run({ answer }: Static<typeof SCHEMA>): Promise<ToolResult> {
    return { state: 'success', content: { submitted: true, answer: String(answer) } };
  }
}
