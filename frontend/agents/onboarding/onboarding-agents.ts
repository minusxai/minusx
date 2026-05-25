// Onboarding agents (OnboardingContextAgent / OnboardingDashboardAgent).
//
// Both run on the normal v=2 chat path (they use the frontend-bridged EditFile /
// CreateFile tools), so they extend WebAnalystAgent and just (a) restrict the
// toolset, (b) cap maxSteps for low latency, (c) render the onboarding-specific
// prompts (`onboarding_context.*` / `onboarding_dashboard.*`, already in
// `orchestrator/prompts/prompts.json`), and (d) disable web search
// (no web search).
import 'server-only';
import { Type } from 'typebox';
import type { TSchema } from 'typebox';
import type { Tool, TextContent, ImageContent } from '@/orchestrator/llm';
import { renderPrompt } from '@/orchestrator/prompts';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { WebAnalystAgent, EditFile, CreateFile } from '@/agents/web-analyst/web-analyst';
import { SearchDBSchema, ExecuteQuery } from '@/agents/benchmark-analyst/db-tools.server';
import { getAnalystModel } from '@/agents/analyst/model-config';
import type { RemoteAnalystContext } from '@/agents/analyst/types';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-onboarding-api',
  provider: 'faux-onboarding',
  models: [{ id: 'stub-onboarding' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const OnboardingAgentParams = Type.Object({
  userMessage: Type.String(),
});

function schemaString(ctx: RemoteAnalystContext): string {
  return ctx.schema ? JSON.stringify(ctx.schema, null, 2) : 'No schema provided.';
}

function goalFrom(raw: string | (TextContent | ImageContent)[]): string {
  if (typeof raw === 'string') return raw;
  return raw
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function onboardingUserContent(
  ctx: RemoteAnalystContext,
  raw: string | (TextContent | ImageContent)[],
  promptId: string,
): (TextContent | ImageContent)[] {
  const appState = ctx.appState !== undefined ? JSON.stringify(ctx.appState) : 'null';
  const text = renderPrompt(promptId, {
    app_state: appState,
    current_date: new Date().toISOString().slice(0, 10),
    goal: goalFrom(raw),
  });
  return [{ type: 'text', text }];
}

/**
 * Onboarding context step: reads schema (SearchDBSchema/ExecuteQuery) and writes
 * markdown docs into the context file via EditFile. Few tools, low max-steps.
 */
export class OnboardingContextAgent extends WebAnalystAgent {
  static override readonly schema: Tool<typeof OnboardingAgentParams> = {
    name: 'OnboardingContextAgent',
    description: 'Onboarding step that documents a database schema into a context file.',
    parameters: OnboardingAgentParams,
  };
  static override readonly tools: Tool<TSchema>[] = [
    SearchDBSchema.schema,
    EditFile.schema,
    ExecuteQuery.schema,
  ];
  static override readonly maxSteps = 15;
  static override model = getAnalystModel() ?? FAUX_MODEL;
  // No web search for onboarding.
  static override readonly callOptions = { reasoning: 'low', webSearch: false };

  protected override resolveCallOptions(): Record<string, unknown> | undefined {
    return (this.constructor as typeof OnboardingContextAgent).callOptions;
  }

  protected override getSystemPrompt(): string {
    const ctor = this.constructor as typeof OnboardingContextAgent;
    return renderPrompt('onboarding_context.system', {
      agent_name: this.context.agentName ?? 'MinusX',
      schema: schemaString(this.context),
      connection_id: this.context.connectionId ?? '',
      max_steps: String(ctor.maxSteps),
    });
  }

  protected override buildUserContent(): (TextContent | ImageContent)[] {
    return onboardingUserContent(this.context, this.userMessage, 'onboarding_context.user');
  }
}

/**
 * Onboarding dashboard step: creates a few questions (CreateFile) with varied
 * viz and assembles a starter dashboard (EditFile).
 */
export class OnboardingDashboardAgent extends WebAnalystAgent {
  static override readonly schema: Tool<typeof OnboardingAgentParams> = {
    name: 'OnboardingDashboardAgent',
    description: 'Onboarding step that creates starter questions and a dashboard.',
    parameters: OnboardingAgentParams,
  };
  static override readonly tools: Tool<TSchema>[] = [
    SearchDBSchema.schema,
    ExecuteQuery.schema,
    CreateFile.schema,
    EditFile.schema,
  ];
  static override readonly maxSteps = 25;
  static override model = getAnalystModel() ?? FAUX_MODEL;
  // No web search for onboarding.
  static override readonly callOptions = { reasoning: 'low', webSearch: false };

  protected override resolveCallOptions(): Record<string, unknown> | undefined {
    return (this.constructor as typeof OnboardingDashboardAgent).callOptions;
  }

  protected override getSystemPrompt(): string {
    const ctor = this.constructor as typeof OnboardingDashboardAgent;
    return renderPrompt('onboarding_dashboard.system', {
      agent_name: this.context.agentName ?? 'MinusX',
      schema: schemaString(this.context),
      context: this.context.contextDocs ?? '',
      connection_id: this.context.connectionId ?? '',
      max_steps: String(ctor.maxSteps),
    });
  }

  protected override buildUserContent(): (TextContent | ImageContent)[] {
    return onboardingUserContent(this.context, this.userMessage, 'onboarding_dashboard.user');
  }
}
