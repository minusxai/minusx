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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE(email)
  );

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
    content TEXT NOT NULL,
    file_references TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    last_edit_id TEXT,
    draft BOOLEAN NOT NULL DEFAULT FALSE,
    meta JSONB DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE(path)
  );

  -- Add file_references column if it doesn't exist (migration for existing tables)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'files' AND column_name = 'file_references'
    ) THEN
      ALTER TABLE files ADD COLUMN file_references TEXT NOT NULL DEFAULT '[]';
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

  -- Drop redundant standalone type index (replaced by composite index below)
  DROP INDEX IF EXISTS idx_files_type;

  CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
  CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_files_type_updated ON files(type, updated_at DESC);

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

`;
