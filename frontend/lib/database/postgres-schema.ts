import { POSTGRES_SCHEMA as POSTGRES_SCHEMA_NAME } from '@/lib/config';

/**
 * Split a SQL string into individual statements, correctly handling dollar-quoted
 * strings ($$...$$, $tag$...$tag$) so semicolons inside them are not treated as
 * statement terminators. Used by both PGLite and Postgres adapters.
 */
export function splitSQLStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let dollarTag: string | null = null;
  let i = 0;

  while (i < sql.length) {
    if (dollarTag === null) {
      if (sql[i] === '$') {
        let j = i + 1;
        while (j < sql.length && sql[j] !== '$' && /\w/.test(sql[j])) j++;
        if (j < sql.length && sql[j] === '$') {
          dollarTag = sql.slice(i, j + 1);
          current += dollarTag;
          i = j + 1;
          continue;
        }
      }
      if (sql[i] === ';') {
        const stmt = current.trim();
        if (stmt) statements.push(stmt);
        current = '';
        i++;
        continue;
      }
    } else if (sql.startsWith(dollarTag, i)) {
      current += dollarTag;
      i += dollarTag.length;
      dollarTag = null;
      continue;
    }
    current += sql[i++];
  }

  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

export const POSTGRES_SCHEMA = `
  CREATE SCHEMA IF NOT EXISTS ${POSTGRES_SCHEMA_NAME};

  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT,
    phone TEXT,
    state TEXT,
    home_folder TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'editor', 'viewer')),
    groups JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE(email)
  );

  -- Access V2: custom-group membership (array of group names from the config
  -- document's "groups" section). The role column IS the built-in group.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS groups JSONB NOT NULL DEFAULT '[]';

  -- Add phone and state columns if they don't exist (migration for existing tables)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'phone'
    ) THEN
      ALTER TABLE users ADD COLUMN phone TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'state'
    ) THEN
      ALTER TABLE users ADD COLUMN state TEXT;
    END IF;
  END $$;

  -- Trigger to auto-update updated_at for users
  CREATE OR REPLACE FUNCTION update_users_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS update_users_updated_at_trigger ON users;
  CREATE TRIGGER update_users_updated_at_trigger
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_users_updated_at();

  -- Files table
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT NOT NULL,
    content JSONB NOT NULL,
    file_references JSONB NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    last_edit_id TEXT,
    draft BOOLEAN NOT NULL DEFAULT FALSE,
    meta JSONB DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
    -- NOTE: path uniqueness is enforced by a PARTIAL unique index (published files only) created
    -- below — NOT a table constraint — so drafts can share a path. See idx_files_path_published_unique.
  );

  -- File Architecture v2 server-only secrets store (resolved at query time, never a files row)
  CREATE TABLE IF NOT EXISTS secrets (
    path TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Add file_references column if it doesn't exist (migration for existing tables)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'files' AND column_name = 'file_references'
    ) THEN
      ALTER TABLE files ADD COLUMN file_references JSONB NOT NULL DEFAULT '[]';
    END IF;
  END $$;

  -- Add version column if it doesn't exist (migration for existing tables)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'files' AND column_name = 'version'
    ) THEN
      ALTER TABLE files ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    END IF;
  END $$;

  -- Add last_edit_id column if it doesn't exist (migration for existing tables)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'files' AND column_name = 'last_edit_id'
    ) THEN
      ALTER TABLE files ADD COLUMN last_edit_id TEXT;
    END IF;
  END $$;

  -- Add draft column if it doesn't exist (migration for existing tables)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'files' AND column_name = 'draft'
    ) THEN
      ALTER TABLE files ADD COLUMN draft BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
  END $$;

  -- Add meta column if it doesn't exist (migration for existing tables)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'files' AND column_name = 'meta'
    ) THEN
      ALTER TABLE files ADD COLUMN meta JSONB DEFAULT NULL;
    END IF;
  END $$;

  -- Index on last_edit_id must come AFTER the ADD COLUMN guard above
  CREATE INDEX IF NOT EXISTS idx_files_last_edit_id ON files(last_edit_id) WHERE last_edit_id IS NOT NULL;
  -- Partial index on draft for efficient "hide drafts" queries
  CREATE INDEX IF NOT EXISTS idx_files_draft ON files (draft) WHERE draft = true;

  -- Path uniqueness applies to PUBLISHED files only. Drafts (draft = true) are exempt, so the agent
  -- can create several drafts at the same display path without colliding. A path becomes unique
  -- again when a draft is published (draft to false). Migrate existing DBs off the old global
  -- UNIQUE(path) table constraint to this partial unique index.
  -- (NOTE: keep these comments free of semicolons -- splitSQLStatements is comment-unaware.)
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = current_schema() AND table_name = 'files' AND constraint_name = 'files_path_key'
    ) THEN
      ALTER TABLE files DROP CONSTRAINT files_path_key;
    END IF;
  END $$;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_files_path_published_unique ON files (path) WHERE draft = false;

  -- Drop redundant standalone type index (replaced by composite index below)
  DROP INDEX IF EXISTS idx_files_type;

  CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
  -- Access V2 (M1b): the permission predicate matches folder scopes with
  -- path LIKE prefix-slash-percent. Accelerating that needs a text_pattern_ops
  -- index on hosted Postgres — but PGLite (the OSS default) rejects the opclass,
  -- and this shared schema runs on both. It's a pure perf optimization
  -- (correctness is unaffected), so hosted deployments add it out-of-band.
  CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_files_type_updated ON files(type, updated_at DESC);
  -- Public-share lookup: resolve a story by the nonce stored in meta.shares[] via jsonb containment.
  CREATE INDEX IF NOT EXISTS idx_files_meta_shares ON files USING gin ((meta -> 'shares') jsonb_path_ops);

  -- Trigger to auto-update updated_at for files
  CREATE OR REPLACE FUNCTION update_files_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS update_files_updated_at_trigger ON files;
  CREATE TRIGGER update_files_updated_at_trigger
  BEFORE UPDATE ON files
  FOR EACH ROW
  EXECUTE FUNCTION update_files_updated_at();

  -- Job runs table for tracking scheduled and manual job executions
  CREATE TABLE IF NOT EXISTS job_runs (
    id               SERIAL PRIMARY KEY,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at     TIMESTAMP NULL,
    job_id           TEXT NOT NULL,
    job_type         TEXT NOT NULL,
    output_file_id   INTEGER NULL,
    output_file_type TEXT NULL,
    status           TEXT NOT NULL DEFAULT 'RUNNING',
    error            TEXT NULL,
    timeout          INTEGER NOT NULL DEFAULT 30,
    source           TEXT NOT NULL DEFAULT 'manual'
  );

  CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, job_type);
  CREATE INDEX IF NOT EXISTS idx_job_runs_created_at ON job_runs(created_at DESC);

-- Configs table for storing system configuration values
  CREATE TABLE IF NOT EXISTS configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Trigger to auto-update updated_at for configs
  CREATE OR REPLACE FUNCTION update_configs_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS update_configs_updated_at_trigger ON configs;
  CREATE TRIGGER update_configs_updated_at_trigger
  BEFORE UPDATE ON configs
  FOR EACH ROW
  EXECUTE FUNCTION update_configs_updated_at();

  -- Analytics tables -----------------------------------------------------------

  CREATE TABLE IF NOT EXISTS file_events (
    id                    BIGSERIAL PRIMARY KEY,
    event_type            SMALLINT NOT NULL,
    file_id               INTEGER NOT NULL,
    file_version          INTEGER,
    referenced_by_file_id INTEGER,
    user_id               INTEGER,
    request_id            UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_fe_file_id ON file_events(file_id);
  CREATE INDEX IF NOT EXISTS idx_fe_user    ON file_events(user_id);
  CREATE INDEX IF NOT EXISTS idx_fe_ts      ON file_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_fe_type    ON file_events(event_type, file_id);

  CREATE TABLE IF NOT EXISTS llm_call_events (
    id                    BIGSERIAL PRIMARY KEY,
    conversation_id       INTEGER NOT NULL,
    llm_call_id           VARCHAR,
    model                 VARCHAR NOT NULL,
    total_tokens          BIGINT NOT NULL DEFAULT 0,
    prompt_tokens         BIGINT NOT NULL DEFAULT 0,
    completion_tokens     BIGINT NOT NULL DEFAULT 0,
    system_prompt_tokens  INTEGER NOT NULL DEFAULT 0,
    app_state_tokens      INTEGER NOT NULL DEFAULT 0,
    total_tool_calls      INTEGER NOT NULL DEFAULT 0,
    cost                  FLOAT8 NOT NULL DEFAULT 0,
    duration_s            FLOAT8 NOT NULL DEFAULT 0,
    finish_reason         VARCHAR,
    trigger               VARCHAR,
    user_id               INTEGER,
    request_id            UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_llm_conv ON llm_call_events(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_llm_ts   ON llm_call_events(created_at);
  -- Enrich the per-call stats now that LLM usage is recorded locally (no proxy).
  ALTER TABLE llm_call_events ADD COLUMN IF NOT EXISTS provider              VARCHAR;
  ALTER TABLE llm_call_events ADD COLUMN IF NOT EXISTS mode                  VARCHAR;
  ALTER TABLE llm_call_events ADD COLUMN IF NOT EXISTS cached_tokens         BIGINT NOT NULL DEFAULT 0;
  ALTER TABLE llm_call_events ADD COLUMN IF NOT EXISTS cache_creation_tokens BIGINT NOT NULL DEFAULT 0;
  ALTER TABLE llm_call_events ADD COLUMN IF NOT EXISTS reasoning_tokens      BIGINT NOT NULL DEFAULT 0;
  ALTER TABLE llm_call_events ADD COLUMN IF NOT EXISTS stream                BOOLEAN NOT NULL DEFAULT false;

  -- Raw pi-format request/response per LLM call, for debugging. Stored LOCALLY
  -- only (never forwarded). Keyed by the same call id the conversation links to
  -- (lllm_call_id). Blobs are JSON text (TOAST-compressed by Postgres).
  CREATE TABLE IF NOT EXISTS llm_logs (
    call_id        VARCHAR PRIMARY KEY,
    user_id        INTEGER,
    provider       VARCHAR,
    model          VARCHAR,
    request_json   TEXT,
    response_json  TEXT,
    error          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_llm_logs_ts ON llm_logs(created_at);

  CREATE TABLE IF NOT EXISTS queries (
    query_hash      VARCHAR PRIMARY KEY,
    query           TEXT,
    params          JSONB,
    schema_context  JSONB,
    connection_name VARCHAR,
    file_id         INTEGER,
    file_version    INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS query_execution_events (
    id              BIGSERIAL PRIMARY KEY,
    query_hash      VARCHAR NOT NULL,
    file_id         INTEGER,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    row_count       INTEGER NOT NULL DEFAULT 0,
    col_count       INTEGER NOT NULL DEFAULT 0,
    was_cache_hit   BOOLEAN NOT NULL DEFAULT false,
    error           TEXT DEFAULT NULL,
    user_id         INTEGER,
    request_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE query_execution_events ADD COLUMN IF NOT EXISTS file_id INTEGER;
  ALTER TABLE query_execution_events DROP COLUMN IF EXISTS query;
  ALTER TABLE query_execution_events DROP COLUMN IF EXISTS params;
  ALTER TABLE query_execution_events DROP COLUMN IF EXISTS schema_context;
  ALTER TABLE query_execution_events DROP COLUMN IF EXISTS connection_name;

  CREATE INDEX IF NOT EXISTS idx_qee_file  ON query_execution_events(file_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_qee_hash  ON query_execution_events(query_hash, created_at);
  CREATE INDEX IF NOT EXISTS idx_qee_ts    ON query_execution_events(created_at);

  CREATE TABLE IF NOT EXISTS feedback_events (
    id                      BIGSERIAL PRIMARY KEY,
    conversation_id         INTEGER NOT NULL,
    user_message_log_index  INTEGER NOT NULL,
    rating                  VARCHAR NOT NULL,
    tags                    JSONB NOT NULL DEFAULT '[]',
    comment                 TEXT DEFAULT '',
    user_id                 INTEGER,
    request_id              UUID,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_fbe_conv  ON feedback_events(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_fbe_ts    ON feedback_events(created_at);

  -- Generic catch-all event log: every published app-event lands here (the local
  -- replacement for a central events store). Typed tables above remain for specific
  -- analytics queries while this stays the raw audit/event stream.
  CREATE TABLE IF NOT EXISTS app_events (
    id          BIGSERIAL PRIMARY KEY,
    event_type  VARCHAR NOT NULL,
    mode        VARCHAR,
    user_id     INTEGER,
    user_email  VARCHAR,
    payload     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_app_events_type ON app_events(event_type, created_at);
  CREATE INDEX IF NOT EXISTS idx_app_events_ts   ON app_events(created_at);

  -- ===========================================================================
  -- Chat Architecture v3: conversations + messages as first-class tables.
  -- Conversations were previously files of type conversation -- v3 normalizes
  -- them into dedicated rows. IDs share the global files id-space (see the
  -- allocator in lib/data/conversations.server.ts) so they never collide and can
  -- be preserved when old file-conversations are backfilled.
  -- (Keep these comments semicolon-free -- splitSQLStatements is comment-unaware.)
  -- ===========================================================================

  CREATE TABLE IF NOT EXISTS conversations (
    id               INTEGER     NOT NULL,
    owner_user_id    INTEGER     NOT NULL,
    mode             TEXT        NOT NULL DEFAULT 'org',
    title            TEXT        NOT NULL DEFAULT 'New Conversation',
    agent            TEXT        NOT NULL DEFAULT 'WebAnalystAgent',
    run_status       TEXT        NOT NULL DEFAULT 'idle',
    run_lease_owner  TEXT,
    run_heartbeat_at TIMESTAMPTZ,
    run_started_seq  INTEGER,
    meta             JSONB       NOT NULL DEFAULT '{}',
    forked_from      INTEGER,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
  );
  -- Keyset-pagination index: owner+mode partition ordered by (updated_at DESC, id DESC) so the
  -- conversation list + its cursor ("load more") is a pure index range scan including the id tiebreak.
  -- Supersedes the old 3-column index (dropped once -- DROP IF EXISTS is a no-op on later boots).
  DROP INDEX IF EXISTS idx_conversations_owner;
  CREATE INDEX IF NOT EXISTS idx_conversations_owner_keyset ON conversations(owner_user_id, mode, updated_at DESC, id DESC);

  CREATE OR REPLACE FUNCTION update_conversations_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS update_conversations_updated_at_trigger ON conversations;
  CREATE TRIGGER update_conversations_updated_at_trigger
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_conversations_updated_at();

  -- One row per conversation event. Two kinds of rows share this table:
  --   pi log entries  -- kind in (toolCall, assistant, toolResult), content = the pi
  --                      entry verbatim, seq = the 0-based contiguous log index AND
  --                      stream cursor (the orchestrator log projection)
  --   errors          -- kind = 'error', seq = NULL (so it never consumes a pi-log
  --                      index), content = { source, message, details } (the parallel
  --                      error stream the chat UI renders, mirrors the old errors[])
  -- NULLs are distinct under UNIQUE, so UNIQUE(conversation_id, seq) still guards the
  -- pi log while permitting many seq=NULL error rows. MAX(seq) and seq-ordered reads
  -- ignore NULLs, so error rows never leak into the reconstructed pi log.
  CREATE TABLE IF NOT EXISTS messages (
    id              BIGSERIAL   PRIMARY KEY,
    conversation_id INTEGER     NOT NULL,
    seq             INTEGER,
    kind            TEXT        NOT NULL,
    pi_id           TEXT,
    parent_pi_id    TEXT,
    content         JSONB       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages(conversation_id, seq);
  -- Error reads (kind='error', ordered by arrival) — partial index keeps it cheap.
  CREATE INDEX IF NOT EXISTS idx_messages_errors ON messages(conversation_id, created_at) WHERE kind = 'error';

  -- Self-heal databases created before errors moved into messages -- idempotent, runs every boot.
  -- (1) messages.seq used to be NOT NULL -- error rows need seq=NULL, so drop the constraint.
  -- (2) the dedicated conversation_errors table is gone -- drop it if a prior boot created it.
  -- (3) messages no longer FK-references conversations (append-hot table, cleanup done in code) --
  --     drop the constraint if an earlier boot created it.
  ALTER TABLE messages ALTER COLUMN seq DROP NOT NULL;
  ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;
  DROP TABLE IF EXISTS conversation_errors;

  -- ===========================================================================
  -- Query Execution, Cache & Params Arch V2.
  -- query_cache: the control-plane index for the durable, cross-instance query
  -- result cache (the big result blob lives in the object store at blob_ref).
  -- It also carries the SWR windows (revalidate_at / expire_at) and the
  -- execution lease (status + lease_expires_at) that dedupes concurrent
  -- misses/revalidations across instances. Replaces the old in-process maps.
  -- (Keep these comments semicolon-free -- splitSQLStatements is comment-unaware.)
  -- ===========================================================================
  CREATE TABLE IF NOT EXISTS query_cache (
    cache_key         TEXT PRIMARY KEY,
    query             TEXT NOT NULL,
    connection_name   TEXT NOT NULL,
    params            JSONB NOT NULL DEFAULT '{}',
    blob_ref          TEXT,
    final_query       TEXT,
    row_count         INTEGER,
    col_count         INTEGER,
    byte_size         INTEGER,
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        BIGINT NOT NULL,
    revalidate_at     BIGINT NOT NULL,
    expire_at         BIGINT NOT NULL,
    lease_expires_at  BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_query_cache_expire ON query_cache(expire_at);

  -- NOTE: there is intentionally NO separate published_queries table. The public
  -- contract is "the published file, executed by id with type-validated params":
  -- a guest sends {fileId, params}, the server loads the file (gated by
  -- canAccessFile to the guest's shared folder), uses the file's FROZEN query,
  -- validates params by their declared type, and binds (never concatenates).
  -- Results land in query_cache like any other query (mode-scoped, so guest and
  -- authenticated runs of the same query share one blob). See arch doc §6.

`;
