import type { AgentContext } from '@/orchestrator/types';
import type { SchemaSource, SqlExecutor } from './sources';

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
  /**
   * Per-run whitelist enforced inside `SearchDBSchema` after the global
   * schema source returns hits. Each entry is either a bare table name
   * (e.g. `'users'`) or a qualified `schema.table` form. `undefined` means
   * no restriction (admin / no-context flow). Array (not Set) so the agent
   * invocation log entry serialises cleanly across orch.resume turns.
   */
  whitelistedTables?: readonly string[];
  /**
   * Markdown context documentation injected into the agent's system prompt
   * so the LLM knows what the data means without re-deriving it.
   */
  contextDocs?: string;
  /**
   * Per-row executor overrides for benchmark/test parallelism. When set,
   * tools use these instead of the global singletons so N rows can run
   * concurrently without shared-state races.
   */
  schemaSource?: SchemaSource;
  sqlExecutor?: SqlExecutor;
}
