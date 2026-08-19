/**
 * The schema, declared.
 *
 * Being data rather than SQL text is the whole point: a deployment that needs a
 * variant maps over this instead of restating every table, so the two can no longer
 * drift. See ./types.ts for why there is no raw-SQL field.
 *
 * This is the shipped source of truth: `postgres-schema.ts` is now only
 * `renderSchema(TABLES, …)`. The equivalence test still checks each table against the
 * catalog the original hand-written SQL produced, which is the evidence that generating
 * the DDL changed nothing about the database it builds.
 */

import type { Schema } from './types';

export const USERS = {
  name: 'users',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'INTEGER', notNull: true },
    { name: 'email', type: 'TEXT', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'password_hash', type: 'TEXT' },
    { name: 'phone', type: 'TEXT' },
    { name: 'state', type: 'TEXT' },
    { name: 'home_folder', type: 'TEXT', notNull: true, default: "''" },
    {
      name: 'role',
      type: 'TEXT',
      notNull: true,
      default: "'viewer'",
      check: "role IN ('admin', 'editor', 'viewer')",
    },
    { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  // Scoped: two namespaces may each have an admin@acme.com. Marking this `global`
  // would make the address unique across the whole deployment.
  uniques: [{ columns: ['email'], scope: 'scoped' }],
  touchUpdatedAt: true,
} as const satisfies Schema[number];

export const FILES = {
  name: 'files',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'INTEGER', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'path', type: 'TEXT', notNull: true },
    { name: 'type', type: 'TEXT', notNull: true },
    { name: 'content', type: 'JSONB', notNull: true },
    { name: 'file_references', type: 'JSONB', notNull: true, default: "'[]'" },
    { name: 'version', type: 'INTEGER', notNull: true, default: '1' },
    { name: 'last_edit_id', type: 'TEXT' },
    { name: 'draft', type: 'BOOLEAN', notNull: true, default: 'FALSE' },
    { name: 'meta', type: 'JSONB', default: 'NULL' },
    { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  // Path uniqueness deliberately is NOT a table constraint: it applies only to
  // published files, so it lives as a partial unique index below and drafts are exempt.
  indexes: [
    { name: 'idx_files_last_edit_id', columns: ['last_edit_id'], where: 'last_edit_id IS NOT NULL' },
    { name: 'idx_files_draft', columns: ['draft'], where: 'draft = true' },
    {
      name: 'idx_files_path_published_unique',
      columns: ['path'],
      unique: true,
      where: 'draft = false',
    },
    { name: 'idx_files_path', columns: ['path'] },
    { name: 'idx_files_updated_at', columns: [{ column: 'updated_at', direction: 'DESC' }] },
    {
      name: 'idx_files_type_updated',
      columns: ['type', { column: 'updated_at', direction: 'DESC' }],
    },
    // Public-share lookup by the nonce in meta.shares[]. Modelled rather than held as
    // raw SQL — an expression index that falls out of the model is invisible to any
    // consumer that rewrites indexes, and ships unscoped.
    {
      name: 'idx_files_meta_shares',
      columns: [{ expression: "meta -> 'shares'" }],
      using: 'gin',
      opclass: 'jsonb_path_ops',
    },
  ],
  touchUpdatedAt: true,
} as const satisfies Schema[number];

export const CONFIGS = {
  name: 'configs',
  scope: 'per-namespace',
  columns: [
    { name: 'key', type: 'TEXT', notNull: true },
    { name: 'value', type: 'TEXT', notNull: true },
    { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['key'],
  touchUpdatedAt: true,
} as const satisfies Schema[number];


export const SECRETS = {
  name: 'secrets',
  scope: 'per-namespace',
  columns: [
    { name: 'path', type: 'TEXT', notNull: true },
    { name: 'value', type: 'TEXT', notNull: true },
    { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['path'],
} as const satisfies Schema[number];

export const JOB_RUNS = {
  name: 'job_runs',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'SERIAL', notNull: true },
    { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    { name: 'completed_at', type: 'TIMESTAMP' },
    { name: 'job_id', type: 'TEXT', notNull: true },
    { name: 'job_type', type: 'TEXT', notNull: true },
    { name: 'output_file_id', type: 'INTEGER' },
    { name: 'output_file_type', type: 'TEXT' },
    { name: 'status', type: 'TEXT', notNull: true, default: "'RUNNING'" },
    { name: 'error', type: 'TEXT' },
    { name: 'timeout', type: 'INTEGER', notNull: true, default: '30' },
    { name: 'source', type: 'TEXT', notNull: true, default: "'manual'" },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_job_runs_job', columns: ['job_id', 'job_type'] },
    { name: 'idx_job_runs_created_at', columns: [{ column: 'created_at', direction: 'DESC' }] },
  ],
} as const satisfies Schema[number];

export const FILE_EVENTS = {
  name: 'file_events',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'BIGSERIAL', notNull: true },
    { name: 'event_type', type: 'SMALLINT', notNull: true },
    { name: 'file_id', type: 'INTEGER', notNull: true },
    { name: 'file_version', type: 'INTEGER' },
    { name: 'referenced_by_file_id', type: 'INTEGER' },
    { name: 'user_id', type: 'INTEGER' },
    { name: 'request_id', type: 'UUID' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_fe_file_id', columns: ['file_id'] },
    { name: 'idx_fe_user', columns: ['user_id'] },
    { name: 'idx_fe_ts', columns: ['created_at'] },
    { name: 'idx_fe_type', columns: ['event_type', 'file_id'] },
  ],
} as const satisfies Schema[number];

export const LLM_CALL_EVENTS = {
  name: 'llm_call_events',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'BIGSERIAL', notNull: true },
    { name: 'conversation_id', type: 'INTEGER', notNull: true },
    { name: 'llm_call_id', type: 'VARCHAR' },
    { name: 'model', type: 'VARCHAR', notNull: true },
    { name: 'total_tokens', type: 'BIGINT', notNull: true, default: '0' },
    { name: 'prompt_tokens', type: 'BIGINT', notNull: true, default: '0' },
    { name: 'completion_tokens', type: 'BIGINT', notNull: true, default: '0' },
    // RESERVED — no writer populates these today (always 0): the pi Usage shape
    // carries no reasoning/system-prompt/app-state split, and tool calls are not
    // counted per call. Kept for schema stability; see `reasoning_tokens` below
    // (also reserved) before assuming any of them holds data.
    { name: 'system_prompt_tokens', type: 'INTEGER', notNull: true, default: '0' },
    { name: 'app_state_tokens', type: 'INTEGER', notNull: true, default: '0' },
    { name: 'total_tool_calls', type: 'INTEGER', notNull: true, default: '0' },
    { name: 'cost', type: 'FLOAT8', notNull: true, default: '0' },
    { name: 'duration_s', type: 'FLOAT8', notNull: true, default: '0' },
    { name: 'finish_reason', type: 'VARCHAR' },
    { name: 'trigger', type: 'VARCHAR' },
    { name: 'user_id', type: 'INTEGER' },
    { name: 'request_id', type: 'UUID' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
    // Added after the table shipped; declared inline now that a column list is the
    // source of truth rather than a CREATE followed by ALTERs.
    { name: 'provider', type: 'VARCHAR' },
    { name: 'mode', type: 'VARCHAR' },
    { name: 'cached_tokens', type: 'BIGINT', notNull: true, default: '0' },
    { name: 'cache_creation_tokens', type: 'BIGINT', notNull: true, default: '0' },
    // RESERVED — plumbed through the recorders but never set: `buildLlmCallDetail`
    // has no source for it (the pi `Usage` shape carries no reasoning-token count).
    { name: 'reasoning_tokens', type: 'BIGINT', notNull: true, default: '0' },
    { name: 'stream', type: 'BOOLEAN', notNull: true, default: 'false' },
    { name: 'grade', type: 'VARCHAR' },
    { name: 'agent', type: 'VARCHAR' },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_llm_conv', columns: ['conversation_id'] },
    { name: 'idx_llm_ts', columns: ['created_at'] },
    { name: 'idx_llm_user_ts', columns: ['user_id', 'created_at'] },
  ],
} as const satisfies Schema[number];

export const LLM_LOGS = {
  name: 'llm_logs',
  scope: 'per-namespace',
  columns: [
    { name: 'call_id', type: 'VARCHAR', notNull: true },
    { name: 'user_id', type: 'INTEGER' },
    { name: 'provider', type: 'VARCHAR' },
    { name: 'model', type: 'VARCHAR' },
    { name: 'request_json', type: 'TEXT' },
    { name: 'response_json', type: 'TEXT' },
    { name: 'error', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
  ],
  primaryKey: ['call_id'],
  indexes: [{ name: 'idx_llm_logs_ts', columns: ['created_at'] }],
} as const satisfies Schema[number];

export const QUERIES = {
  name: 'queries',
  scope: 'per-namespace',
  columns: [
    { name: 'query_hash', type: 'VARCHAR', notNull: true },
    { name: 'query', type: 'TEXT' },
    { name: 'params', type: 'JSONB' },
    { name: 'schema_context', type: 'JSONB' },
    { name: 'connection_name', type: 'VARCHAR' },
    { name: 'file_id', type: 'INTEGER' },
    { name: 'file_version', type: 'INTEGER' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
  ],
  primaryKey: ['query_hash'],
} as const satisfies Schema[number];

export const QUERY_EXECUTION_EVENTS = {
  name: 'query_execution_events',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'BIGSERIAL', notNull: true },
    { name: 'query_hash', type: 'VARCHAR', notNull: true },
    { name: 'file_id', type: 'INTEGER' },
    { name: 'duration_ms', type: 'INTEGER', notNull: true, default: '0' },
    { name: 'row_count', type: 'INTEGER', notNull: true, default: '0' },
    { name: 'col_count', type: 'INTEGER', notNull: true, default: '0' },
    { name: 'was_cache_hit', type: 'BOOLEAN', notNull: true, default: 'false' },
    { name: 'error', type: 'TEXT', default: 'NULL' },
    { name: 'user_id', type: 'INTEGER' },
    { name: 'request_id', type: 'UUID' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_qee_file', columns: ['file_id', 'created_at'] },
    { name: 'idx_qee_hash', columns: ['query_hash', 'created_at'] },
    { name: 'idx_qee_ts', columns: ['created_at'] },
  ],
} as const satisfies Schema[number];

export const FEEDBACK_EVENTS = {
  name: 'feedback_events',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'BIGSERIAL', notNull: true },
    { name: 'conversation_id', type: 'INTEGER', notNull: true },
    { name: 'user_message_log_index', type: 'INTEGER', notNull: true },
    { name: 'rating', type: 'VARCHAR', notNull: true },
    { name: 'tags', type: 'JSONB', notNull: true, default: "'[]'" },
    { name: 'comment', type: 'TEXT', default: "''" },
    { name: 'user_id', type: 'INTEGER' },
    { name: 'request_id', type: 'UUID' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_fbe_conv', columns: ['conversation_id', 'created_at'] },
    { name: 'idx_fbe_ts', columns: ['created_at'] },
  ],
} as const satisfies Schema[number];

export const APP_EVENTS = {
  name: 'app_events',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'BIGSERIAL', notNull: true },
    { name: 'event_type', type: 'VARCHAR', notNull: true },
    { name: 'mode', type: 'VARCHAR' },
    { name: 'user_id', type: 'INTEGER' },
    { name: 'user_email', type: 'VARCHAR' },
    { name: 'payload', type: 'JSONB', notNull: true, default: "'{}'" },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_app_events_type', columns: ['event_type', 'created_at'] },
    { name: 'idx_app_events_ts', columns: ['created_at'] },
  ],
} as const satisfies Schema[number];

export const CONVERSATIONS = {
  name: 'conversations',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'INTEGER', notNull: true },
    { name: 'owner_user_id', type: 'INTEGER', notNull: true },
    { name: 'mode', type: 'TEXT', notNull: true, default: "'org'" },
    { name: 'title', type: 'TEXT', notNull: true, default: "'New Conversation'" },
    { name: 'agent', type: 'TEXT', notNull: true, default: "'WebAnalystAgent'" },
    { name: 'run_status', type: 'TEXT', notNull: true, default: "'idle'" },
    { name: 'run_lease_owner', type: 'TEXT' },
    { name: 'run_heartbeat_at', type: 'TIMESTAMPTZ' },
    { name: 'run_started_seq', type: 'INTEGER' },
    { name: 'meta', type: 'JSONB', notNull: true, default: "'{}'" },
    { name: 'forked_from', type: 'INTEGER' },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
    { name: 'updated_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
  ],
  primaryKey: ['id'],
  indexes: [
    {
      name: 'idx_conversations_owner_keyset',
      columns: [
        'owner_user_id',
        'mode',
        { column: 'updated_at', direction: 'DESC' },
        { column: 'id', direction: 'DESC' },
      ],
    },
  ],
  touchUpdatedAt: true,
} as const satisfies Schema[number];

export const MESSAGES = {
  name: 'messages',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'BIGSERIAL', notNull: true },
    { name: 'conversation_id', type: 'INTEGER', notNull: true },
    // Nullable by design: error rows carry seq = NULL so they never consume a pi-log
    // index. NULLs are distinct under UNIQUE, so many may coexist.
    { name: 'seq', type: 'INTEGER' },
    { name: 'kind', type: 'TEXT', notNull: true },
    { name: 'pi_id', type: 'TEXT' },
    { name: 'parent_pi_id', type: 'TEXT' },
    { name: 'content', type: 'JSONB', notNull: true },
    { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
  ],
  primaryKey: ['id'],
  // Scoped: conversation ids are allocated per namespace, so the same
  // (conversation_id, seq) legitimately exists in two of them.
  uniques: [{ columns: ['conversation_id', 'seq'], scope: 'scoped' }],
  indexes: [
    { name: 'idx_messages_conv_seq', columns: ['conversation_id', 'seq'] },
    {
      name: 'idx_messages_errors',
      columns: ['conversation_id', 'created_at'],
      where: "kind = 'error'",
    },
  ],
} as const satisfies Schema[number];

export const QUERY_CACHE = {
  name: 'query_cache',
  scope: 'per-namespace',
  columns: [
    { name: 'cache_key', type: 'TEXT', notNull: true },
    { name: 'query', type: 'TEXT', notNull: true },
    { name: 'connection_name', type: 'TEXT', notNull: true },
    { name: 'params', type: 'JSONB', notNull: true, default: "'{}'" },
    { name: 'blob_ref', type: 'TEXT' },
    { name: 'final_query', type: 'TEXT' },
    { name: 'row_count', type: 'INTEGER' },
    { name: 'col_count', type: 'INTEGER' },
    { name: 'byte_size', type: 'INTEGER' },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'created_at', type: 'BIGINT', notNull: true },
    { name: 'revalidate_at', type: 'BIGINT', notNull: true },
    { name: 'expire_at', type: 'BIGINT', notNull: true },
    { name: 'lease_expires_at', type: 'BIGINT', notNull: true },
  ],
  primaryKey: ['cache_key'],
  indexes: [{ name: 'idx_query_cache_expire', columns: ['expire_at'] }],
} as const satisfies Schema[number];

/**
 * Login codes (OTP), one row per issued code.
 *
 * The code's digest lives here and NOT in anything handed to the client. The
 * predecessor design put `sha256(code)` inside a JWT that `send-otp` returned in its
 * response body — a JWT payload is base64url, not encrypted, so an unauthenticated
 * caller could enumerate all 10^6 six-digit digests offline and recover the code
 * without ever calling `verify-otp`. No amount of rate limiting on the verify endpoint
 * can fix that; the digest simply must not leave the server. Everything else this table
 * provides — the attempt counter, single-use consumption — is state the stateless
 * design could not hold at all.
 *
 * Two clocks, deliberately different. `expires_at` is when the CODE stops being usable
 * (minutes). Rows outlive that, because the send-rate throttle counts `created_at`
 * over a longer window; deleting a row as soon as its code expired would reset the
 * throttle. `AuthCodesDB.issue` prunes on `created_at + OTP_RETENTION_MS`.
 *
 * Deliberately absent from `lib/database/import-export.ts`, which enumerates only
 * `users` and `files`: a short-lived login credential must not survive an
 * export/import migration round-trip.
 */
export const AUTH_CODES = {
  name: 'auth_codes',
  scope: 'per-namespace',
  columns: [
    // Opaque 32-byte random handle. This is what the client holds and returns; it is a
    // lookup key, not a secret verifier, so nothing is derivable from it.
    { name: 'handle', type: 'TEXT', notNull: true },
    { name: 'email', type: 'TEXT', notNull: true },
    { name: 'code_hash', type: 'TEXT', notNull: true },
    {
      name: 'channel',
      type: 'TEXT',
      notNull: true,
      check: "channel IN ('email', 'phone')",
    },
    { name: 'attempts', type: 'INTEGER', notNull: true, default: '0' },
    // Epoch milliseconds, following `query_cache` — a BIGINT is read back identically by
    // both adapters, where a TIMESTAMP is a Date on `pg` and an ISO string on PGLite.
    { name: 'consumed_at', type: 'BIGINT' },
    { name: 'expires_at', type: 'BIGINT', notNull: true },
    { name: 'created_at', type: 'BIGINT', notNull: true },
  ],
  primaryKey: ['handle'],
  indexes: [
    // The send-rate throttle: count an email's rows inside the window.
    { name: 'idx_auth_codes_email_created', columns: ['email', 'created_at'] },
    // Retention pruning.
    { name: 'idx_auth_codes_created', columns: ['created_at'] },
  ],
} as const satisfies Schema[number];

/**
 * Failed-password counters, one row per address.
 *
 * A password check is an oracle: it answers "is this the password for this account",
 * and it answered unlimited times. `check-2fa` was the cheapest way to ask, but the
 * credentials callback answers identically, so throttling one endpoint would only have
 * moved the question — the counter therefore lives under the shared decision in
 * `lib/auth/credential-login.ts` and covers every caller of it.
 *
 * Rows are keyed on the SUBMITTED address, lowercased, and are written before the user
 * lookup: engaging the counter only for addresses that resolve would make a
 * rate-limited response a user-existence oracle, which is the leak the decoy in
 * `send-otp` exists to close.
 *
 * Deliberately absent from `lib/database/import-export.ts` (which enumerates only
 * `users` and `files`) — a transient counter must not survive a migration round-trip.
 */
export const LOGIN_ATTEMPTS = {
  name: 'login_attempts',
  scope: 'per-namespace',
  columns: [
    { name: 'email', type: 'TEXT', notNull: true },
    { name: 'failures', type: 'INTEGER', notNull: true, default: '0' },
    // Epoch milliseconds. Start of the window the count belongs to, not the last
    // failure: the window is fixed once opened, so a steady drip of guesses cannot keep
    // pushing the expiry out and hold an address locked indefinitely.
    { name: 'window_started_at', type: 'BIGINT', notNull: true },
  ],
  primaryKey: ['email'],
  indexes: [{ name: 'idx_login_attempts_window', columns: ['window_started_at'] }],
} as const satisfies Schema[number];

export const PUBLIC_DATA = {
  name: 'public_data',
  scope: 'public',
  columns: [
    { name: 'key', type: 'TEXT', notNull: true },
    { name: 'value', type: 'TEXT', notNull: true },
    { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['key'],
  indexes: [
    /**
     * Some keys identify their namespace rather than describing it — a third-party
     * workspace id, for instance — and those must resolve to exactly ONE namespace or
     * the lookup they exist for is ambiguous. Global, therefore, and partial: it
     * constrains only the keys that carry that meaning, leaving ordinary per-namespace
     * keys (`data_version`) free to repeat.
     */
    {
      name: 'idx_public_data_binding_unique',
      columns: ['key'],
      unique: true,
      scope: 'global',
      where: "key LIKE 'binding:%'",
    },
  ],
} as const satisfies Schema[number];

/**
 * The complete schema, in dependency-free order (there are no foreign keys — see
 * ./types.ts — so the only ordering constraint is a table before its own indexes).
 */
export const TABLES: Schema = [
  USERS, FILES, SECRETS, JOB_RUNS, CONFIGS,
  FILE_EVENTS, LLM_CALL_EVENTS, LLM_LOGS, QUERIES, QUERY_EXECUTION_EVENTS,
  FEEDBACK_EVENTS, APP_EVENTS, CONVERSATIONS, MESSAGES, QUERY_CACHE, AUTH_CODES,
  LOGIN_ATTEMPTS, PUBLIC_DATA,
];
