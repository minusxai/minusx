// MicroAgent.
//
// A generic leaf agent with NO tools: one LLM call that runs a *named* task
// (`MICRO_TASKS`) — title, description, summary, … — and returns text. Unlike
// FeedSummaryAgent there is no per-use-case subclass: the task key in the
// context selects the prompts. Renders `micro.<task>.system` / `micro.<task>.user`
// from `orchestrator/prompts/prompts.yaml`. Runs headless via `runMicroTask`.
import 'server-only';
import { Type } from 'typebox';
import type { Tool, TextContent, ImageContent, AssistantMessage } from '@/orchestrator/llm';
import { renderPrompt } from '@/orchestrator/prompts';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { getMicroModelOrTestFallback, getMicroModelOptions } from './model-config';
import { getMicroTask } from './micro-tasks';
import type { MicroAgentContext } from './types';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-micro-api',
  provider: 'faux-micro',
  models: [{ id: 'stub-micro' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const MicroAgentParams = Type.Object({
  userMessage: Type.String(),
});

export class MicroAgent extends RemoteAnalystAgent {
  static readonly schema: Tool<typeof MicroAgentParams> = {
    name: 'MicroAgent',
    description: 'Runs a single-turn named micro-task (title/description/summary/…) from a prompt template. No tools.',
    parameters: MicroAgentParams,
  };
  // No tools — one LLM turn, returns text.
  static override readonly tools: Tool<typeof MicroAgentParams>[] = [];
  static override model = getMicroModelOrTestFallback(FAUX_MODEL);
  static override readonly callOptions = getMicroModelOptions();

  private get microContext(): MicroAgentContext {
    return this.context as MicroAgentContext;
  }

  protected override getSystemPrompt(): string {
    const cfg = getMicroTask(this.microContext.taskKey);
    return renderPrompt(cfg.systemPromptKey, this.microContext.vars);
  }

  protected override buildUserContent(): (TextContent | ImageContent)[] {
    const cfg = getMicroTask(this.microContext.taskKey);
    const text = renderPrompt(cfg.userPromptKey, this.microContext.vars);
    return [{ type: 'text', text }, ...(this.microContext.images ?? [])];
  }

  // Honor the task's optional per-task model override; otherwise the class default.
  protected override async llm(): Promise<AssistantMessage> {
    const cfg = getMicroTask(this.microContext.taskKey);
    const model = cfg.model ?? (this.constructor as typeof MicroAgent).model;
    return this.orchestrator.callLLM(model, this.buildLLMContext(), this.id, this.resolveCallOptions());
  }
}
