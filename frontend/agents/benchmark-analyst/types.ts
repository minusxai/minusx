import type { AgentContext } from '@/orchestrator/types';

/**
 * Connection metadata as carried in `BenchmarkAnalystContext.connections`.
 *
 * Two flavours, distinguished by the presence of `config`:
 * - **Metadata-only** (`config` absent): just name + dialect + optional
 *   description. Used by the production analyst path where connectors are
 *   resolved server-side via `ConnectionsAPI.getRawByName`. The list
 *   serves only `ListDBConnections` (LLM never sees the config).
 * - **Connector-config-included** (`config` present): full JSON blob
 *   needed to instantiate a `NodeConnector`. Used by the benchmark CLI
 *   runner and by chat-continuation of benchmark conversations. The
 *   `BaseExecuteQuery` / `BaseSearchDBSchema` tool variants instantiate
 *   connectors directly from these entries.
 *
 * `config` is JSON-serialisable so the whole `ConnectionInfo[]` round-trips
 * through agent-context serialisation (logged, resumed) without losing
 * fidelity. It may contain credentials (Postgres password,
 * `service_account_json`, …) — this is acceptable because the production
 * path never populates `config`, and the benchmark/continuation paths
 * already store the same configs on the conversation file's
 * `meta.benchmark_connections`. `ListDBConnections` strips `config` before
 * surfacing the list to the LLM.
 */
export interface ConnectionInfo {
  name: string;
  dialect: string;
  description?: string;
  config?: Record<string, unknown>;
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
}
