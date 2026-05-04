import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/src/tool';
import type { ToolResult } from '@/orchestrator/src/types';

interface ClarifyOption {
  label: string;
  description?: string;
}

interface Args {
  question: string;
  options: ClarifyOption[];
  multiSelect?: boolean;
}

export class Clarify extends Tool<Args> {
  readonly name = 'Clarify';
  readonly description =
    'Ask the user for clarification when their request is ambiguous. Use this tool when the user\'s request has multiple valid interpretations or additional information is needed. Try to limit to 3 options for best UX.';
  readonly schema = Type.Object({
    question: Type.String({ description: 'The question to ask the user' }),
    options: Type.Array(
      Type.Object({
        label: Type.String(),
        description: Type.Optional(Type.String()),
      }),
      { description: 'List of options, each with label and optional description' },
    ),
    multiSelect: Type.Optional(Type.Boolean({ description: 'If true, user can select multiple options' })),
  });

  /**
   * Headless default: there's no user to ask, so the agent figures it out itself.
   * `WebClarifyTool` overrides this to return `state: 'pending'` so the runAgent
   * loop terminates and the frontend can display the question to the user.
   */
  async run(_args: Args): Promise<ToolResult> {
    return { state: 'success', content: 'Figure it out.' };
  }
}
