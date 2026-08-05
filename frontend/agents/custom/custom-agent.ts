import type { Tool } from '@/orchestrator/llm';
import { renderPrompt } from '@/orchestrator/prompts';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { WebAnalystAgent } from '@/agents/web-analyst/web-analyst';

/**
 * User-defined custom agent (AgentEntry on the context file), resolved
 * server-side into `context.customAgent` by setupOrchestration. Runs the exact
 * WebAnalystAgent loop and toolset — the definition only shapes the prompt
 * (persona, append/replace), user-defined skill exposure (preloads ride
 * `context.selectedSkills`, while `customAgent.skillAllowlist` restricts
 * on-demand user skills; system skills remain page-managed), and the default LLM grade (applied in
 * setupOrchestration). One registered class serves every definition: the
 * per-turn context carries the resolved definition, so saved-log resume
 * reconstructs the same behavior from `REGISTRABLES` by this schema name.
 */
export class CustomAgent extends WebAnalystAgent {
  static readonly schema: Tool<typeof RemoteAnalystAgent.schema.parameters> = {
    name: 'CustomAgent',
    description:
      'User-defined specialist agent configured on the Knowledge Base context. ' +
      'Same toolset as WebAnalystAgent; the stored definition shapes prompt, skills, and grade.',
    parameters: RemoteAnalystAgent.schema.parameters,
  };

  protected getSystemPrompt(): string {
    const def = this.context.customAgent;
    // Append mode (and the no-definition fallback) renders the default analyst
    // prompt — buildSystemPromptVars injects the persona into {agent_persona}.
    if (!def || def.promptMode === 'append') return super.getSystemPrompt();
    // Replace mode: the author's prompt replaces the default intro + guidelines;
    // the app structure and dynamic runtime sections (schema, context, skills,
    // connection, home folder) are still rendered by the replace template. The
    // persona is substituted as a VALUE (never template-resolved) so braces stay
    // literal.
    return renderPrompt('custom_agent_replace.system', {
      ...this.buildSystemPromptVars(),
      agent_persona: def.prompt,
    });
  }
}
