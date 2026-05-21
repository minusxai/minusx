// SubmitAnswer — benchmark eval tool.
//
// The benchmark eval `validate(llm_output)` scans the agent's output for
// specific strings, numbers-near-names (within N chars), ordered lists,
// etc. The agent's verbose final message (TL;DR + Analysis + markdown
// tables) is far too noisy — validators fail when extra prose separates
// a name from its value.
//
// `SubmitAnswer` lets the agent submit a compact, eval-optimised answer
// string as a tool call. The eval script can extract the `answer` argument
// directly — no parsing of huge assistant messages required. The tool
// itself is a no-op (returns the answer as confirmation); the real value
// is that the answer lives in a structured, extractable location in the
// conversation log.

import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext } from './types';

const SubmitAnswerParams = Type.Object({
    questionParts: Type.String({
    description:
      'Specific items from the question that the answer needs to contain, as bullet points. For example, if the question is "What are the total sales for Product X and Product Y? Also include as % of total.", the questionParts might be "- Product X total sales \n - Product Y total sales \n - Product X % of total \n - Product Y % of total". This is for your reference — it does not need to be included in the final answer string, but it helps you reflect on what the question is asking for and ensure you include everything in your final answer.',
  }),
    answer: Type.String({
    description:
      'Your final answer, formatted for the eval validator. Pack names immediately adjacent to their numbers/values (no filler words between them). For lists, put each item on its own line (like a markdown table). This exact string is what the eval function receives — make it compact and precise.',
  }),
    justification: Type.String({
    description:
      '2-3 sentences justification for your answer, maybe mentioning methodology, assumptions, or uncertainties.',
  }),
});

interface SubmitAnswerDetails extends Record<string, unknown> {
  answer: string;
  justification: string;
}

export class SubmitAnswer extends MXTool<typeof SubmitAnswerParams, BenchmarkAnalystContext, SubmitAnswerDetails> {
  static readonly schema: Tool<typeof SubmitAnswerParams> = {
    name: 'SubmitAnswer',
    description:
      'Submit your final answer for evaluation. Call this as the LAST tool. The `answer` string is extracted verbatim by the eval function, so format it precisely: names immediately next to their values, no filler words, each list item on its own line (like a markdown table). Example: "Product X | $123,456|\\nProduct Y | $789,012".',
    parameters: SubmitAnswerParams,
  };

  async run(): Promise<ToolResponse<SubmitAnswerDetails>> {
    const { answer, justification } = this.parameters;
    return {
      content: [{ type: 'text', text: JSON.stringify({ submitted: true, answer }) }],
      isError: false,
      details: { answer, justification },
    };
  }
}
