/**
 * Single source of truth for database schema
 * Used by both create-empty-db.ts and documents-db.ts
 */

export const DATABASE_SCHEMA = `
  -- Companies table (multi-tenant architecture)
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    subdomain TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TRIGGER IF NOT EXISTS update_companies_updated_at
  AFTER UPDATE ON companies
  FOR EACH ROW
  BEGIN
    UPDATE companies SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

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

  CREATE TRIGGER IF NOT EXISTS update_users_updated_at
  AFTER UPDATE ON users
  FOR EACH ROW
  BEGIN
    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE company_id = NEW.company_id AND id = NEW.id;
  END;

  -- Files table (multi-tenant architecture with per-company ID sequences)
  CREATE TABLE IF NOT EXISTS files (
    company_id INTEGER NOT NULL,
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    file_references TEXT NOT NULL DEFAULT '[]',  -- JSON array of file IDs this file references
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (company_id, id),
    UNIQUE(company_id, path),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  -- Drop redundant standalone type index (replaced by composite index below)
  DROP INDEX IF EXISTS idx_files_type;

  CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
  CREATE INDEX IF NOT EXISTS idx_files_company_id ON files(company_id);
  CREATE INDEX IF NOT EXISTS idx_files_path_company ON files(company_id, path);
  CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_files_company_type_updated ON files(company_id, type, updated_at DESC);

  CREATE TRIGGER IF NOT EXISTS update_files_updated_at
  AFTER UPDATE ON files
  FOR EACH ROW
  BEGIN
    UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE company_id = NEW.company_id AND id = NEW.id;
  END;

  -- Access tokens table for public file sharing (token as primary key)
  CREATE TABLE IF NOT EXISTS access_tokens (
    token TEXT PRIMARY KEY,
    company_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    view_as_user_id INTEGER NOT NULL,
    created_by_user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_active INTEGER DEFAULT 1,
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

  CREATE TRIGGER IF NOT EXISTS update_configs_updated_at
  AFTER UPDATE ON configs
  FOR EACH ROW
  BEGIN
    UPDATE configs SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
  END;
`;
