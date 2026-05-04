/**
 * Analyst-specific RunContext extension via TypeScript declaration merging.
 *
 * Tools in `agents/src/analyst/` access `ctx.user`, `ctx.schema`, etc. without
 * orchestrator/ taking a dependency on frontend/lib/auth.
 */
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/** Whitelist of schemas/tables the agent is allowed to access (matches Python `_schema`). */
export interface SchemaWhitelistEntry {
  schema: string;
  tables: string[];
}

declare module '@/orchestrator/src/types' {
  interface RunContext {
    /** Authenticated user for tool execution (file reads, query execution). */
    user?: EffectiveUser;
    /** Schema whitelist injected as `_schema` arg to schema-aware tools. null = full schema. */
    schema?: SchemaWhitelistEntry[] | null;
    /** Active connection for query execution. */
    connectionId?: string;
    /** User's home folder (already resolved against mode). */
    homeFolder?: string;
  }
}

export type { EffectiveUser };
