import type { AgentContext } from '@/orchestrator/types';

/** Metadata about a database connection visible to the agent. */
export interface ConnectionInfo {
  name: string;
  dialect: string;
  description?: string;
}

/**
 * Base context shape for the benchmark analyst hierarchy. Carries just the
 * minimum DB tools need: a per-run list of connections the agent is allowed
 * to use. RemoteAnalystAgent extends this with app-specific fields
 * (userId, mode, effectiveUser, ...).
 */
export interface BenchmarkAnalystContext extends AgentContext {
  connections?: ConnectionInfo[];
}
