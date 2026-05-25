// Eval Submit tools (SubmitBinary/SubmitNumber/SubmitString/CannotAnswer).
// Server-side leaf tools the eval agent calls
// exactly once to submit its final answer; the run terminates afterward.
import 'server-only';
import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, type ToolResponse } from '@/orchestrator/types';

/** Names of the submit tools — used by the eval agent to detect termination. */
export const SUBMIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'SubmitBinary',
  'SubmitNumber',
  'SubmitString',
  'CannotAnswer',
]);

function submitResponse(payload: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: false,
    details: payload,
  };
}

const SubmitBinaryParams = Type.Object({
  answer: Type.Boolean({ description: 'True for yes/correct, False for no/incorrect' }),
});
export class SubmitBinary extends MXTool<typeof SubmitBinaryParams> {
  static readonly schema: Tool<typeof SubmitBinaryParams> = {
    name: 'SubmitBinary',
    description: 'Submit a binary (yes/no) answer for an eval assertion. Call exactly once with your final answer.',
    parameters: SubmitBinaryParams,
  };
  async run(): Promise<ToolResponse> {
    return submitResponse({ submitted: true, answer: Boolean(this.parameters.answer) });
  }
}

const SubmitNumberParams = Type.Object({
  answer: Type.Number({ description: 'Numeric answer to the eval question' }),
});
export class SubmitNumber extends MXTool<typeof SubmitNumberParams> {
  static readonly schema: Tool<typeof SubmitNumberParams> = {
    name: 'SubmitNumber',
    description: 'Submit a numeric answer for a number_match eval assertion. Call exactly once with your final computed answer.',
    parameters: SubmitNumberParams,
  };
  async run(): Promise<ToolResponse> {
    return submitResponse({ submitted: true, answer: Number(this.parameters.answer) });
  }
}

const SubmitStringParams = Type.Object({
  answer: Type.String({ description: 'String answer to the eval question' }),
});
export class SubmitString extends MXTool<typeof SubmitStringParams> {
  static readonly schema: Tool<typeof SubmitStringParams> = {
    name: 'SubmitString',
    description: 'Submit a string answer for a string_match eval assertion. Call exactly once with your final string answer.',
    parameters: SubmitStringParams,
  };
  async run(): Promise<ToolResponse> {
    return submitResponse({ submitted: true, answer: String(this.parameters.answer) });
  }
}

const CannotAnswerParams = Type.Object({
  reason: Type.String({ description: 'Why the question cannot be answered' }),
});
export class CannotAnswer extends MXTool<typeof CannotAnswerParams> {
  static readonly schema: Tool<typeof CannotAnswerParams> = {
    name: 'CannotAnswer',
    description: 'Signal that the question cannot be answered with the available data.',
    parameters: CannotAnswerParams,
  };
  async run(): Promise<ToolResponse> {
    return submitResponse({ submitted: true, cannot_answer: true, reason: String(this.parameters.reason) });
  }
}
