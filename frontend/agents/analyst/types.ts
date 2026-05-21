import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { BenchmarkAnalystContext, ConnectionInfo } from '@/agents/benchmark-analyst/types';

// Re-export so existing imports keep working.
export type { ConnectionInfo };

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
}

// Backward-compat alias — pre-existing import sites use this name.
export type AnalystAgentContext = RemoteAnalystContext;
