import type { AgentContext } from '@/orchestrator/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConnectorConfigMap, ConnectorDialect } from '@/lib/connections/base';

/** Metadata about a database connection visible to the agent. */
export interface ConnectionInfo {
  name: string;
  dialect: string;
  description?: string;
}

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
 * Context shape for AnalystAgent (and its descendants like SlackAgent and the
 * benchmark variant). Carries everything analyst tools / system-prompt rendering
 * need: the calling user, the workspace mode, the active app state, the
 * available DB connections, and the resolved EffectiveUser for FilesAPI calls.
 *
 * This lives in `agents/analyst/` (not `orchestrator/types.ts`) so the
 * orchestrator stays free of MinusX-specific app types.
 */
export interface AnalystAgentContext extends AgentContext {
  userId: string;
  mode: 'org' | 'tutorial';
  connectionId?: string;
  appState?: unknown;
  connections?: ConnectionInfo[];
  effectiveUser?: EffectiveUser;
}
