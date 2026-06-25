// Eval agent.
//
// A RemoteAnalystAgent variant for the eval harness: it answers a question using
// the analyst's read-only tools, then calls a Submit tool exactly once. The run
// terminates as soon as a Submit tool result appears. The assertion-type instruction comes from the
// `eval_addendum.*` prompts (already in orchestrator/prompts/prompts.yaml).
import 'server-only';
import { Type } from 'typebox';
import type { TSchema } from 'typebox';
import type { Tool, AssistantMessage, ToolResultMessage } from '@/orchestrator/llm';
import type { MXAgent } from '@/orchestrator/types';
import { renderPrompt } from '@/orchestrator/prompts';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import {
  RemoteAnalystAgent,
  ListDBConnections,
  SearchDBSchema,
  ExecuteQuery,
  ReadFiles,
  SearchFiles,
} from '@/agents/analyst/analyst-agent';
import { getAgentModelOrTestFallback } from '@/agents/analyst/model-config';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import { SubmitBinary, SubmitNumber, SubmitString, CannotAnswer, SUBMIT_TOOL_NAMES } from './submit-tools';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-eval-api',
  provider: 'faux-eval',
  models: [{ id: 'stub-eval' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

export type EvalAssertionType = 'binary' | 'number_match' | 'string_match';

export interface EvalAnalystContext extends RemoteAnalystContext {
  assertionType: EvalAssertionType;
}

const EvalAgentParams = Type.Object({
  userMessage: Type.String(),
});

export class EvalAnalystAgent extends RemoteAnalystAgent {
  static override readonly schema: Tool<typeof EvalAgentParams> = {
    name: 'TestAgent',
    description: 'Eval runner: answers a question via read-only analyst tools, then submits a final answer.',
    parameters: EvalAgentParams,
  };
  // Read-only analyst tools + all Submit tools. The eval_addendum.<type> prompt
  // steers the model to the correct Submit tool for the assertion.
  static override readonly tools: Tool<TSchema>[] = [
    ListDBConnections.schema,
    SearchDBSchema.schema,
    ExecuteQuery.schema,
    ReadFiles.schema,
    SearchFiles.schema,
    SubmitBinary.schema,
    SubmitNumber.schema,
    SubmitString.schema,
    CannotAnswer.schema,
  ];
  static override model = getAgentModelOrTestFallback(FAUX_MODEL);
  static override readonly callOptions = { reasoning: 'low', webSearch: false };

  protected override resolveCallOptions(): Record<string, unknown> | undefined {
    return (this.constructor as typeof EvalAnalystAgent).callOptions;
  }

  protected override getSystemPrompt(): string {
    const base = super.getSystemPrompt();
    const assertionType = (this.context as EvalAnalystContext).assertionType;
    return base + renderPrompt('eval_addendum.preamble', {}) + renderPrompt(`eval_addendum.${assertionType}`, {});
  }

  // Same agentic loop as MXAgent.run, but also stops as soon as a Submit tool
  // result is recorded.
  override async run(): Promise<AssistantMessage> {
    const ctor = this.constructor as typeof EvalAnalystAgent;
    let lastMsg: AssistantMessage | undefined;
    while (this.toolThread.length < ctor.maxSteps) {
      lastMsg = await this.llm();
      if (lastMsg.stopReason === 'stop') return lastMsg;
      await this.orchestrator.dispatch(lastMsg, this as unknown as MXAgent);
      if (this._submitCalled()) return lastMsg;
    }
    return {
      ...(lastMsg as AssistantMessage),
      content: [{ type: 'text', text: `Maximum iterations (${ctor.maxSteps}) reached.` }],
      stopReason: 'stop',
      timestamp: Date.now(),
    };
  }

  private _submitCalled(): boolean {
    return this.toolThread.some(
      (m): m is ToolResultMessage =>
        'role' in m && m.role === 'toolResult' && SUBMIT_TOOL_NAMES.has((m as ToolResultMessage).toolName),
    );
  }
}
