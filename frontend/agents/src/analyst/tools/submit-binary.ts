import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/src/tool';
import type { ToolResult } from '@/orchestrator/src/types';

interface Args {
  answer: boolean;
}

export class SubmitBinary extends Tool<Args> {
  readonly name = 'SubmitBinary';
  readonly description =
    'Submit a binary (yes/no) answer for an eval assertion. Use this tool when asked to answer a binary question during evaluation. Call this exactly once with your final answer.';
  readonly schema = Type.Object({
    answer: Type.Boolean({ description: 'True for yes/correct, False for no/incorrect' }),
  });

  async run({ answer }: Args): Promise<ToolResult> {
    return { state: 'success', content: { submitted: true, answer: Boolean(answer) } };
  }
}
