import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { AgentSkillSelection, AgentUserSkillCatalogItem } from '@/lib/types';
import type { ResolvedContextDocs } from '@/lib/types';
import type { BenchmarkAnalystContext } from '@/agents/benchmark-analyst/types';

/**
 * Context shape for RemoteAnalystAgent (and SlackAgent / WebAnalystAgent).
 * Extends BenchmarkAnalystContext (DB tools + connections) with the
 * MinusX-app-specific fields the file tools, system prompt, and AppState
 * wrap need.
 */
export interface RemoteAnalystContext extends BenchmarkAnalystContext {
  userId: string;
  mode: 'org' | 'tutorial';
  connectionId?: string;
  appState?: unknown;
  effectiveUser?: EffectiveUser;
  /** Viz types the agent may use (client-resolved from config). Empty/undefined → "all". */
  allowedVizTypes?: string[];
  /** Whitelisted schema (client-resolved); injected into the prompt. */
  schema?: { schema: string; tables: string[] }[];
  /** Resolved home-folder path; injected into the prompt. */
  homeFolder?: string;
  /** User role (admin/editor/viewer); injected into the prompt. */
  role?: string;
  /** Display/branding name the agent introduces itself as. */
  agentName?: string;
  /**
   * Page type derived server-side from agent_args.app_state (via getPageType).
   * Drives skill preloading. Kept separate from the (intentionally null)
   * `<AppState>` user-message block, so populating it doesn't leak app_state.
   */
  pageType?: string | null;
  /** Selected skills for this turn (agent_args.skills.selected). */
  selectedSkills?: AgentSkillSelection[];
  /** User-defined skill catalog (agent_args.skills.user_catalog). */
  userSkillCatalog?: AgentUserSkillCatalogItem[];
  /** Whether navigation is unrestricted (picks the navigation_unrestricted skill). */
  unrestrictedMode?: boolean;
  /** User-message attachments (images pre-converted to base64, plus text). */
  attachments?: AgentAttachment[];
  /** Approximate user city — biases web-search results. */
  city?: string;
  /**
   * Resolved context docs (STRUCTURE), server-resolved from the request's context
   * pointer. One list tagged with alwaysInclude — the source of truth for the
   * system prompt's Context section AND the LoadContext tool. (The inherited
   * `contextDocs: string` is the benchmark/onboarding representation and is unused
   * on the interactive path.)
   */
  resolvedContextDocs?: ResolvedContextDocs;
}

/**
 * A user-message attachment, normalized server-side for the LLM. Image content
 * is either base64 (`data` + `mimeType`) or a remote URL (`url`, loaded by
 * Anthropic via the pi patch).
 */
export type AgentAttachment =
  | { type: 'image'; data?: string; mimeType?: string; url?: string }
  | { type: 'text'; name?: string; content: string; pages?: number };

// Backward-compat alias — pre-existing import sites use this name.
export type AnalystAgentContext = RemoteAnalystContext;
