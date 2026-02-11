/**
 * PostgreSQL-specific database schema
 * Converted from SQLite schema with PostgreSQL syntax
 */

export const POSTGRES_SCHEMA = `
  -- Companies table (multi-tenant architecture)
  CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    subdomain TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Trigger to auto-update updated_at for companies
  CREATE OR REPLACE FUNCTION update_companies_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS update_companies_updated_at_trigger ON companies;
  CREATE TRIGGER update_companies_updated_at_trigger
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION update_companies_updated_at();

  -- Users table (multi-tenant architecture with per-company ID sequences)
  CREATE TABLE IF NOT EXISTS users (
    company_id INTEGER NOT NULL,
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
    PRIMARY KEY (company_id, id),
    UNIQUE(company_id, email),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
  CREATE INDEX IF NOT EXISTS idx_users_email_company ON users(company_id, email);

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

  -- Files table (multi-tenant architecture with per-company ID sequences)
  CREATE TABLE IF NOT EXISTS files (
    company_id INTEGER NOT NULL,
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    file_references TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (company_id, id),
    UNIQUE(company_id, path),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  -- Add file_references column if it doesn't exist (migration for existing tables)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'files' AND column_name = 'file_references'
    ) THEN
      ALTER TABLE files ADD COLUMN file_references TEXT NOT NULL DEFAULT '[]';
    END IF;
  END $$;

  -- Drop redundant standalone type index (replaced by composite index below)
  DROP INDEX IF EXISTS idx_files_type;

  CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
  CREATE INDEX IF NOT EXISTS idx_files_company_id ON files(company_id);
  CREATE INDEX IF NOT EXISTS idx_files_path_company ON files(company_id, path);
  CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_files_company_type_updated ON files(company_id, type, updated_at DESC);

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

  -- Access tokens table for public file sharing (token as primary key)
  CREATE TABLE IF NOT EXISTS access_tokens (
    token TEXT PRIMARY KEY,
    company_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    view_as_user_id INTEGER NOT NULL,
    created_by_user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT true,
    FOREIGN KEY (company_id, file_id) REFERENCES files(company_id, id) ON DELETE CASCADE,
    FOREIGN KEY (company_id, view_as_user_id) REFERENCES users(company_id, id) ON DELETE CASCADE,
    FOREIGN KEY (company_id, created_by_user_id) REFERENCES users(company_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_access_tokens_company_file ON access_tokens(company_id, file_id);
  CREATE INDEX IF NOT EXISTS idx_access_tokens_company ON access_tokens(company_id);
  CREATE INDEX IF NOT EXISTS idx_access_tokens_expires_at ON access_tokens(expires_at);

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
`;
