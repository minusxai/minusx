# Database Scripts

This directory contains scripts for managing the Atlas BI document database.

## Scripts

### `export-db.ts`
Exports the current database contents to STDOUT

**Usage:**
```bash
npm run export-db
```

**What it does:**
- Reads all questions and dashboards from `atlas_documents.db`
- Converts UUID-based references to slug-based references
- Generates slugs from document titles (e.g., "User Activity (Filtered)" → "user-activity-filtered")

**When to use:**
- Before making changes to seed data
- To backup current database state
- To share initial data with team members

---

### `import-db.ts`
Database import tool with smart defaults and company selection.

**Usage:**
```bash
npm run import-db -- --replace-db=y
```

**What it does:**
- Creates database schema in `atlas_documents.db`
- Reads `lib/database/init-data.json`
- Imports all questions and dashboards
- Converts slug-based references to ID-based references

**When to use:**
- First-time database setup
- After modifying `lib/database/init-data.json`
- To reset database to seed state