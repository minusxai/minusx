/**
 * Database migration registry and utilities
 * Supports both data format migrations and schema changes
 */

import { InitData, CompanyData } from './import-export';
import { LATEST_DATA_VERSION, LATEST_SCHEMA_VERSION } from './constants';
import { DEFAULT_STYLES } from '@/lib/branding/whitelabel';

export type DataMigration = (data: InitData) => InitData;
export type SchemaMigration = null;  // Null means "recreate DB with new schema"

export interface MigrationEntry {
  dataVersion?: number;      // Target data version (if data format changes)
  schemaVersion?: number;    // Target schema version (if schema changes)
  dataMigration?: DataMigration;   // Function to migrate data
  schemaMigration?: SchemaMigration;  // null = recreate DB
  description: string;
}

/**
 * Migration registry: Array of migrations in chronological order
 * Each migration bumps either data version, schema version, or both
 */
export const MIGRATIONS: MigrationEntry[] = [
  {
    dataVersion: 2,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Transform legacy flat array format to nested company structure

      // Check if already using nested structure
      const firstCompany = data.companies[0] as any;
      if (firstCompany && ('users' in firstCompany || 'documents' in firstCompany)) {
        return data;  // Already in nested format
      }

      // Transform legacy flat arrays to nested structure
      const legacyData = data as any;

      const companiesData: CompanyData[] = (legacyData.companies || []).map((company: any) => {
        const companyUsers = (legacyData.users || []).filter((u: any) => u.company_id === company.id);
        const companyDocs = (legacyData.documents || []).filter((d: any) => d.company_id === company.id);

        return {
          id: company.id,
          name: company.name,
          display_name: company.display_name,
          subdomain: company.subdomain,
          created_at: company.created_at,
          updated_at: company.updated_at,
          users: companyUsers,
          documents: companyDocs
        };
      });

      return {
        version: 2,
        companies: companiesData
      };
    },
    description: 'Restructure data format to per-company nested structure'
  },
  {
    dataVersion: 2,  // Data version stays at 2
    schemaVersion: 2,  // Schema bumps to 2
    schemaMigration: null,  // null = recreate DB with new schema
    dataMigration: (data: InitData) => {
      // No data transformation needed!
      // Existing IDs are preserved exactly as-is
      // Per-company sequences will start from MAX(id) + 1 per company
      return data;
    },
    description: 'Change to per-company auto-increment IDs with composite primary keys'
  },
  {
    dataVersion: 3,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // DEPRECATED: This migration added content.name field
      // Migration v8 removes it, so this is now a no-op
      return data;
    },
    description: 'DEPRECATED (v8): Ensure all file content has required "name" field (removed in v8)'
  },
  {
    dataVersion: 4,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Create default config file for each company if it doesn't exist

      for (const companyData of data.companies as CompanyData[]) {
        // Check if config file already exists
        const configExists = companyData.documents.some(
          doc => doc.path === '/configs/config' && doc.type === 'config'
        );

        if (configExists) {
          continue;  // Skip if config already exists
        }

        // Get next available ID for this company
        const maxId = companyData.documents.reduce(
          (max, doc) => Math.max(max, doc.id),
          0
        );
        const nextId = maxId + 1;

        // Create default config file with empty branding
        const now = new Date().toISOString();
        const configDoc = {
          id: nextId,
          name: 'config',
          path: '/configs/config',
          type: 'config' as const,
          references: [],  // Phase 6: Config files have no references
          content: {
            branding: {}  // Empty branding - will fall back to hardcoded values
          },
          company_id: companyData.id,
          created_at: now,
          updated_at: now
        };

        companyData.documents.push(configDoc);
        console.log(`  ✅ Created default config file for company ${companyData.name} (ID: ${nextId})`);
      }

      return data;
    },
    description: 'Create default config file for each company at /configs/config'
  },
  {
    dataVersion: 5,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Create default styles.css file for each company if it doesn't exist

      for (const companyData of data.companies as CompanyData[]) {
        // Check if styles file already exists
        const stylesExists = companyData.documents.some(
          doc => doc.path === '/configs/styles' && doc.type === 'styles'
        );

        if (stylesExists) {
          continue;  // Skip if styles.css already exists
        }

        // Get next available ID for this company
        const maxId = companyData.documents.reduce(
          (max, doc) => Math.max(max, doc.id),
          0
        );
        const nextId = maxId + 1;

        // Create default styles file with DEFAULT_STYLES
        const now = new Date().toISOString();
        const stylesDoc = {
          id: nextId,
          name: 'styles',
          path: '/configs/styles',
          type: 'styles' as const,
          references: [],  // Phase 6: Styles files have no references
          content: {
            styles: DEFAULT_STYLES  // CSS string wrapped in object
          },
          company_id: companyData.id,
          created_at: now,
          updated_at: now
        };

        companyData.documents.push(stylesDoc);
        console.log(`  ✅ Created default styles for company ${companyData.name} (ID: ${nextId})`);
      }

      return data;
    },
    description: 'Create default styles file for each company at /configs/styles'
  },
  {
    dataVersion: 6,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Move all top-level folders inside /org/ for mode-based file system isolation
      // This enables support for multiple modes (org vs tutorial vs sandbox)

      for (const companyData of data.companies as CompanyData[]) {
        console.log(`  Migrating company: ${companyData.name}`);

        // Define paths to migrate (top-level folders to move inside /org/)
        const pathsToMigrate = [
          { from: '/database', to: '/org/database' },
          { from: '/configs', to: '/org/configs' },
          { from: '/logs', to: '/org/logs' },
          { from: '/recordings', to: '/org/recordings' },
        ];

        // Update document paths
        let migratedCount = 0;
        for (const doc of companyData.documents) {
          // Skip paths already inside /org/ (e.g., /org/team-a stays as-is)
          if (doc.path.startsWith('/org/')) {
            continue;
          }

          // Apply migrations
          for (const { from, to } of pathsToMigrate) {
            if (doc.path === from || doc.path.startsWith(from + '/')) {
              const oldPath = doc.path;
              doc.path = doc.path.replace(from, to);
              console.log(`    Migrated: ${oldPath} → ${doc.path}`);
              migratedCount++;
              break;  // Only apply one migration per document
            }
          }
        }

        // Create /org folder if it doesn't exist
        const orgFolderExists = companyData.documents.some(
          doc => doc.path === '/org' && doc.type === 'folder'
        );

        if (!orgFolderExists) {
          const maxId = companyData.documents.reduce(
            (max, doc) => Math.max(max, doc.id),
            0
          );
          const nextId = maxId + 1;
          const now = new Date().toISOString();

          companyData.documents.push({
            id: nextId,
            name: 'org',
            path: '/org',
            type: 'folder' as const,
            references: [],  // Phase 6: Folders references are computed dynamically from children
            content: {
              description: 'Organization workspace (default mode)'
            },
            company_id: companyData.id,
            created_at: now,
            updated_at: now
          });

          console.log(`    ✅ Created /org folder (ID: ${nextId})`);
        }

        console.log(`  ✅ Migration complete for ${companyData.name} (${migratedCount} paths updated)`);
      }

      return data;
    },
    description: 'Move all top-level folders inside /org/ for mode-based isolation'
  },
  {
    dataVersion: 7,
    schemaVersion: 3,  // Schema bumps to 3 for home_folder DEFAULT change
    schemaMigration: null,  // null = recreate DB with new schema (DEFAULT '' instead of '/org')
    dataMigration: (data: InitData) => {
      // Convert user home_folder from physical paths to relative paths
      // Examples:
      //   Admin: Any path → '' (mode root - full access within mode)
      //   Non-admin: '/org/sales/team1' → 'sales/team1'
      //   Non-admin: '/org' → '' (empty for mode root)

      for (const companyData of data.companies as CompanyData[]) {
        console.log(`  Converting home_folder paths for company: ${companyData.name}`);

        let convertedCount = 0;
        for (const user of companyData.users) {
          const oldHomeFolder = user.home_folder;

          // Admins get mode root (full access within their current mode)
          if (user.role === 'admin') {
            if (oldHomeFolder !== '') {
              user.home_folder = '';
              console.log(`    Admin ${user.email}: ${oldHomeFolder} → '' (mode root)`);
              convertedCount++;
            }
            continue;
          }

          // Non-admins: convert physical path to relative path
          // Remove '/org' prefix to get relative path
          if (oldHomeFolder === '/org' || oldHomeFolder === '/org/') {
            user.home_folder = '';  // Empty string for mode root
            console.log(`    ${user.email}: ${oldHomeFolder} → '' (mode root)`);
            convertedCount++;
          } else if (oldHomeFolder.startsWith('/org/')) {
            user.home_folder = oldHomeFolder.substring(5);  // Remove '/org/' prefix
            console.log(`    ${user.email}: ${oldHomeFolder} → ${user.home_folder}`);
            convertedCount++;
          } else if (!oldHomeFolder.startsWith('/')) {
            // Already relative, no change needed
            console.log(`    ${user.email}: Already relative (${oldHomeFolder})`);
          } else {
            // Unexpected format, log warning
            console.warn(`    WARNING: ${user.email} has unexpected home_folder: ${oldHomeFolder}`);
          }
        }

        console.log(`  ✅ Converted ${convertedCount} home_folder paths for ${companyData.name}`);
      }

      return data;
    },
    description: 'Convert user home_folder from physical paths to relative paths for mode-awareness'
  },
  {
    dataVersion: 8,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Strip 'name' field from all file content objects
      // Name is now stored ONLY in file.name (DB column), not duplicated in content

      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents) {
          if (doc.content && typeof doc.content === 'object') {
            // Remove name field from content
            delete (doc.content as any).name;
          }
        }
      }

      return data;
    },
    description: 'Remove content.name field - decouple metadata from content'
  },
  {
    dataVersion: 9,
    schemaVersion: 4,  // Schema bumps to 4 for references column
    schemaMigration: null,  // null = recreate DB with new schema (add references column)
    dataMigration: (data: InitData) => {
      // Backfill references column from content.assets
      // Extract question IDs from dashboard/presentation/notebook/report content

      function extractReferencesFromContent(content: any, type: string): number[] {
        // Handle document types (dashboard, presentation, notebook, report)
        if (
          type === 'dashboard' ||
          type === 'presentation' ||
          type === 'notebook' ||
          type === 'report'
        ) {
          const assets = content?.assets || [];
          return assets
            .filter((a: any) => a.type === 'question' && typeof a.id === 'number')
            .map((a: any) => a.id);
        }

        return [];
      }

      for (const companyData of data.companies as CompanyData[]) {
        console.log(`  Backfilling references for company: ${companyData.name}`);
        let backfilledCount = 0;

        for (const doc of companyData.documents) {
          const references = extractReferencesFromContent(doc.content, doc.type);
          (doc as any).references = references;

          if (references.length > 0) {
            backfilledCount++;
            console.log(`    ${doc.path}: ${references.length} references`);
          }
        }

        console.log(`  ✅ Backfilled ${backfilledCount} files for ${companyData.name}`);
      }

      return data;
    },
    description: 'Add references column and backfill from content.assets'
  },
  {
    dataVersion: 10,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Add versioning to context files
      // Convert existing contexts from top-level databases/docs to versions array

      for (const companyData of data.companies as CompanyData[]) {
        console.log(`  Adding versioning to context files for company: ${companyData.name}`);
        let migratedCount = 0;

        for (const doc of companyData.documents) {
          // Only process context files
          if (doc.type !== 'context') continue;

          const content = doc.content as any;

          // Skip if already has versions
          if (content.versions) {
            console.log(`    ${doc.path}: Already has versions, skipping`);
            continue;
          }

          // Create version 1 from current content
          const now = new Date().toISOString();
          const versionedContent = {
            versions: [{
              version: 1,
              databases: content.databases || [],
              docs: content.docs || [],
              createdAt: now,
              createdBy: 1,  // System user (admin)
              description: 'Initial version (auto-migrated)'
            }],
            published: { all: 1 },
            // Remove legacy fields
            databases: undefined,
            docs: undefined,
            // Preserve computed fields if present
            fullSchema: content.fullSchema,
            fullDocs: content.fullDocs
          };

          // Remove undefined fields
          if (versionedContent.databases === undefined) delete versionedContent.databases;
          if (versionedContent.docs === undefined) delete versionedContent.docs;

          doc.content = versionedContent;
          migratedCount++;
          console.log(`    ${doc.path}: Migrated to version 1`);
        }

        console.log(`  ✅ Migrated ${migratedCount} context files for ${companyData.name}`);
      }

      return data;
    },
    description: 'Add versioning to context files'
  },
  {
    dataVersion: 11,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Convert context docs from string[] to DocEntry[] with childPaths support

      for (const companyData of data.companies as CompanyData[]) {
        console.log(`  Converting context docs to DocEntry[] for company: ${companyData.name}`);
        let migratedCount = 0;

        for (const doc of companyData.documents) {
          // Only process context files
          if (doc.type !== 'context') continue;

          const content = doc.content as any;
          if (!content || !content.versions) continue;

          // Migrate each version's docs array
          for (const version of content.versions) {
            if (!version.docs) {
              version.docs = [];
              continue;
            }

            // Convert string[] to DocEntry[]
            if (Array.isArray(version.docs)) {
              version.docs = version.docs.map((doc: string | any) => {
                // If already an object with content field, keep it
                if (typeof doc === 'object' && doc.content) {
                  return doc;
                }
                // Convert string to DocEntry
                return {
                  content: typeof doc === 'string' ? doc : '',
                  // No childPaths = applies to all children (backward compatible)
                };
              });
            }
          }

          // Clear fullDocs (computed field, will be regenerated on load)
          delete content.fullDocs;

          migratedCount++;
          console.log(`    ${doc.path}: Migrated docs to DocEntry[]`);
        }

        console.log(`  ✅ Migrated ${migratedCount} context files for ${companyData.name}`);
      }

      return data;
    },
    description: 'Convert context docs from string[] to DocEntry[] with childPaths support'
  },
  {
    dataVersion: 12,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Backfill subdomains for companies that don't have one
      // Generate from company name: lowercase, replace non-alphanumeric with hyphens

      const existingSubdomains = new Set<string>();

      // First pass: collect existing subdomains
      for (const companyData of data.companies as CompanyData[]) {
        if (companyData.subdomain) {
          existingSubdomains.add(companyData.subdomain);
        }
      }

      // Second pass: backfill missing subdomains
      for (const companyData of data.companies as CompanyData[]) {
        if (companyData.subdomain) {
          console.log(`  ${companyData.name}: Already has subdomain "${companyData.subdomain}"`);
          continue;
        }

        // Generate subdomain from company name
        let baseSubdomain = companyData.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        let subdomain = baseSubdomain;
        let suffix = 1;

        // Handle collisions by appending number
        while (existingSubdomains.has(subdomain)) {
          subdomain = `${baseSubdomain}-${suffix}`;
          suffix++;
        }

        companyData.subdomain = subdomain;
        existingSubdomains.add(subdomain);
        console.log(`  ✅ Set subdomain for "${companyData.name}": ${subdomain}`);
      }

      return data;
    },
    description: 'Backfill subdomains for existing companies (subdomain-based routing)'
  },
  {
    dataVersion: 13,
    schemaVersion: 5,  // Schema bumps to 5 for phone and state columns
    schemaMigration: null,  // null = recreate DB with new schema
    dataMigration: (data: InitData) => {
      // No data transformation needed - phone and state are new optional fields
      // They will default to NULL for existing users
      return data;
    },
    description: 'Add phone and state fields to users table for 2FA support'
  },
  {
    dataVersion: 14,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Add updated_at to all connection schemas
      const currentTimestamp = new Date().toISOString();

      for (const company of data.companies) {
        for (const doc of company.documents) {
          // Only process connection files
          if (doc.type === 'connection') {
            const content = doc.content as any;

            // If schema exists but no updated_at, add it
            if (content?.schema && !content.schema.updated_at) {
              content.schema.updated_at = currentTimestamp;
              console.log(`[Migration V14] Added updated_at to connection ${doc.name}`);
            }
          }
        }
      }

      return data;
    },
    description: 'Add updated_at timestamp to connection schemas for caching'
  },
  {
    dataVersion: undefined,  // No data format change
    schemaVersion: 6,  // Schema bumps to 6
    schemaMigration: null,  // null = recreate DB with new schema (subdomain NOT NULL)
    dataMigration: (data: InitData) => {
      // Ensure all companies have valid subdomains before applying NOT NULL constraint
      for (const companyData of data.companies as CompanyData[]) {
        if (!companyData.subdomain) {
          // Generate subdomain from company name (same logic as registration endpoint)
          const subdomain = companyData.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

          if (!subdomain || subdomain.length === 0) {
            throw new Error(`Cannot generate valid subdomain for company "${companyData.name}". Company name must contain at least one alphanumeric character.`);
          }

          companyData.subdomain = subdomain;
          console.log(`[Migration V6] Set subdomain for company "${companyData.name}": ${subdomain}`);
        }
      }

      return data;
    },
    description: 'Make subdomain NOT NULL constraint in companies table'
  }
];

/**
 * Get target versions after applying all migrations
 */
export function getTargetVersions(): { dataVersion: number; schemaVersion: number } {
  return {
    dataVersion: LATEST_DATA_VERSION,
    schemaVersion: LATEST_SCHEMA_VERSION
  };
}

/**
 * Fix known schema issues in data — runs unconditionally after every migration pass,
 * including when no version-gated migrations were needed ("empty migration").
 * Add new fixups here as issues are discovered.
 */
export function fixData(data: InitData): InitData {
  for (const company of data.companies as CompanyData[]) {
    for (const doc of company.documents) {
      const content = doc.content as any;
      if (!content || typeof content !== 'object') continue;

      // Dashboard: coerce layout item IDs from string to integer
      if (doc.type === 'dashboard') {
        const items = content.layout?.items;
        if (Array.isArray(items)) {
          content.layout.items = items.map((item: any) => ({
            ...item,
            id: typeof item.id === 'string' ? parseInt(item.id, 10) : item.id,
          }));
        }
      }

      // Question: add default pivotConfig when type is 'pivot' but config is missing
      if (doc.type === 'question') {
        const viz = content.vizSettings;
        if (viz?.type === 'pivot' && viz.pivotConfig == null) {
          viz.pivotConfig = { rows: [], columns: [], values: [] };
        }
      }
    }
  }
  return data;
}

/**
 * Apply all migrations to data starting from specified version
 */
export function applyMigrations(data: InitData, fromDataVersion: number): InitData {
  let currentData = data;
  let currentVersion = data.version || fromDataVersion;

  for (const migration of MIGRATIONS) {
    if (migration.dataVersion && migration.dataVersion > currentVersion && migration.dataMigration) {
      console.log(`📦 Applying data migration: ${migration.description}`);
      currentData = migration.dataMigration(currentData);
      currentData.version = migration.dataVersion;
      currentVersion = migration.dataVersion;
    }
  }

  return fixData(currentData);
}

/**
 * Check if schema migration is needed
 */
export function needsSchemaMigration(currentSchemaVersion: number): boolean {
  return MIGRATIONS.some(
    m => m.schemaVersion && m.schemaVersion > currentSchemaVersion && m.schemaMigration === null
  );
}
