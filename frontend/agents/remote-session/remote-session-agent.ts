import type { TSchema } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { WebAnalystAgent } from '@/agents/web-analyst/web-analyst';

/**
 * Session root for a Remote Agent Session ("Copy to Agent"): an EXTERNAL agent (e.g. Claude Code)
 * authors this conversation's tool calls over HTTP — no LLM loop runs on our side. The class exists
 * so the append-only log has a well-formed root invocation (`name: 'RemoteSessionAgent'`) that the
 * orchestrator can reconstruct (`reconstructAgent`) to serve as `dispatch()`'s parent, and so the
 * session has a declared toolset. Its inherited `run()` (the LLM loop) is never called.
 *
 * Toolset = WebAnalystAgent's leaf tools minus ClarifyFrontend: the external agent has its own
 * human channel (its terminal/chat), and a MinusX clarify-modal while the side chat is frozen
 * would be confusing double-UX. See REMOTE_AGENT_SESSIONS.md §12.
 */
export class RemoteSessionAgent extends WebAnalystAgent {
  static readonly schema: Tool<typeof WebAnalystAgent.schema.parameters> = {
    name: 'RemoteSessionAgent',
    description:
      'Root invocation for a remote agent session — tool calls are authored by an external agent over HTTP, not by an LLM.',
    parameters: WebAnalystAgent.schema.parameters,
  };
  static readonly tools: Tool<TSchema>[] = WebAnalystAgent.tools.filter(
    (t) => t.name !== 'ClarifyFrontend',
  );
}
