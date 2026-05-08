import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConnectorConfigMap, ConnectorDialect } from '@/lib/connections/base';
import type { BenchmarkAnalystContext, ConnectionInfo } from '@/agents/benchmark-analyst/types';

// Re-export so existing imports keep working.
export type { ConnectionInfo };

/** Full connection entry used in benchmark config (JSON file or env var). */
export type BenchmarkConnectionEntry = {
  [D in ConnectorDialect]: {
    name: string;
    dialect: D;
    config: ConnectorConfigMap[D];
    description?: string;
  };
}[ConnectorDialect];

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
}

// Backward-compat alias — pre-existing import sites use this name.
export type AnalystAgentContext = RemoteAnalystContext;
