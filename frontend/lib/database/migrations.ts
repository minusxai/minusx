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
          updated_at: now,
          version: 1,
          last_edit_id: null,
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
          updated_at: now,
          version: 1,
          last_edit_id: null,
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
            updated_at: now,
            version: 1,
            last_edit_id: null,
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
    dataVersion: 16,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Remove all documents at or under any /*/logs/llm_calls path.
      // llm_call was scaffolded but never used — only empty folder nodes can exist.
      const LLM_CALLS_RE = /^\/[^/]+\/logs\/llm_calls(\/|$)/;

      for (const companyData of data.companies as CompanyData[]) {
        const before = companyData.documents.length;
        companyData.documents = companyData.documents.filter(
          doc => !LLM_CALLS_RE.test(doc.path)
        );
        const removed = before - companyData.documents.length;
        if (removed > 0) {
          console.log(`  ✅ Removed ${removed} llm_calls document(s) for company ${companyData.name}`);
        }
      }

      return data;
    },
    description: 'Remove llm_call folders from all modes (llm_call type was never used)'
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
  },
  {
    dataVersion: 15,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Migrate question parameter value → defaultValue
      // For all questions: set defaultValue = defaultValue ?? value, then strip value

      for (const companyData of data.companies as CompanyData[]) {
        let migratedCount = 0;

        for (const doc of companyData.documents) {
          if (doc.type !== 'question') continue;

          const content = doc.content as any;
          if (!content?.parameters || !Array.isArray(content.parameters)) continue;

          let changed = false;
          for (const param of content.parameters) {
            if (param.defaultValue === undefined || param.defaultValue === null) {
              if (param.value !== undefined && param.value !== null) {
                param.defaultValue = param.value;
                changed = true;
              }
            }
            if ('value' in param) {
              delete param.value;
              changed = true;
            }
          }

          if (changed) {
            migratedCount++;
          }
        }

        if (migratedCount > 0) {
          console.log(`  ✅ Migrated ${migratedCount} question parameters for ${companyData.name}`);
        }
      }

      return data;
    },
    description: 'Migrate question parameter value → defaultValue'
  },
  {
    dataVersion: 17,
    schemaVersion: undefined,  // No schema change
    dataMigration: (data: InitData) => {
      // Migrate question parameters: move defaultValue into parameterValues dict, strip from params
      for (const companyData of data.companies as CompanyData[]) {
        let migratedCount = 0;

        for (const doc of companyData.documents) {
          if (doc.type !== 'question') continue;

          const content = doc.content as any;
          if (!content?.parameters || !Array.isArray(content.parameters)) continue;

          // Build parameterValues from existing defaultValues
          const newParamValues: Record<string, any> = { ...(content.parameterValues || {}) };
          let changed = false;

          for (const param of content.parameters) {
            if (param.defaultValue !== undefined && param.defaultValue !== null) {
              // Only set if not already in parameterValues
              if (!(param.name in newParamValues)) {
                newParamValues[param.name] = param.defaultValue;
              }
              delete param.defaultValue;
              changed = true;
            }
          }

          if (changed) {
            content.parameterValues = Object.keys(newParamValues).length > 0 ? newParamValues : undefined;
            migratedCount++;
          }
        }

        if (migratedCount > 0) {
          console.log(`  ✅ Migrated defaultValue → parameterValues for ${migratedCount} questions in ${companyData.name}`);
        }
      }

      return data;
    },
    description: 'Migrate question parameter defaultValue → content.parameterValues'
  },
  {
    dataVersion: undefined,  // No data format change
    schemaVersion: 8,        // Schema bumps to 8 for revised job_runs table
    schemaMigration: null,   // null = recreate DB with new schema
    dataMigration: (data: InitData) => data,
    description: 'Revise job_runs table: drop input/output blobs, rename file_id→output_file_id, error_message→error, add output_file_type'
  },
  {
    dataVersion: 18,
    schemaVersion: undefined,
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        // Find /org files with id < 100
        const docsToRemap = companyData.documents.filter(
          doc => doc.id < 100 && (doc.path === '/org' || doc.path.startsWith('/org/'))
        );

        if (docsToRemap.length === 0) continue;

        console.log(`  [V18] Company "${companyData.name}": found ${docsToRemap.length} /org doc(s) with id < 100`);

        // Find max ID currently in use
        const maxId = companyData.documents.reduce((max, doc) => Math.max(max, doc.id), 0);
        let nextId = Math.max(maxId, 199) + 1;

        // Build old→new ID mapping
        const idRemap = new Map<number, number>();
        for (const doc of docsToRemap) {
          idRemap.set(doc.id, nextId++);
        }

        // Apply remapping to all documents
        for (const doc of companyData.documents) {
          // Remap the document's own ID
          if (idRemap.has(doc.id)) {
            const oldId = doc.id;
            doc.id = idRemap.get(doc.id)!;
            console.log(`    Remapped ${doc.path}: ID ${oldId} → ${doc.id}`);
          }

          // Remap file_references array
          if (doc.references && doc.references.length > 0) {
            doc.references = doc.references.map((refId: number) => idRemap.get(refId) ?? refId);
          }

          // Remap content.assets (FileReference items in dashboards)
          const assets = (doc.content as any)?.assets;
          if (Array.isArray(assets)) {
            for (const asset of assets) {
              if (asset.type === 'question' && typeof asset.id === 'number' && idRemap.has(asset.id)) {
                asset.id = idRemap.get(asset.id)!;
              }
            }
          }

          // Remap content.layout.items (layout positions reference question IDs)
          const layoutItems = (doc.content as any)?.layout?.items;
          if (Array.isArray(layoutItems)) {
            for (const item of layoutItems) {
              if (typeof item.id === 'number' && idRemap.has(item.id)) {
                item.id = idRemap.get(item.id)!;
              }
            }
          }
        }

        console.log(`  ✅ [V18] Remapped ${docsToRemap.length} /org docs for company "${companyData.name}"`);
      }

      return data;
    },
    description: 'Reassign /org file IDs < 100 to IDs > 100 to prevent tutorial reset from deleting them'
  },
  {
    schemaVersion: 7,
    dataVersion: 19,
    schemaMigration: null,
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents) {
          (doc as any).last_edit_id = 'from_migration';
          (doc as any).version = 1;
        }
      }
      return data;
    },
    description: 'Add version and last_edit_id columns for OCC; seed existing rows with version=1, last_edit_id=from_migration'
  },
  {
    dataVersion: 20,
    schemaVersion: undefined,
    dataMigration: (data: InitData) => {
      // Migrate alert and report files: convert emails: string[] → recipients: AlertRecipient[]
      // Each email becomes { channel: 'email_alert', address: '<email>' }
      // No backward compatibility — old emails field is removed

      for (const companyData of data.companies as CompanyData[]) {
        let migratedCount = 0;

        for (const doc of companyData.documents) {
          if (doc.type !== 'alert' && doc.type !== 'report') continue;

          const content = doc.content as any;
          if (!content) continue;

          if (Array.isArray(content.emails)) {
            if (content.emails.length > 0) {
              content.recipients = content.emails.map((address: string) => ({
                channel: 'email_alert',
                address,
              }));
              console.log(`    [V20] ${doc.path}: Migrated ${content.emails.length} email(s) to recipients`);
            } else if (!content.recipients) {
              content.recipients = [];
            }
            delete content.emails;
            migratedCount++;
          }
        }

        if (migratedCount > 0) {
          console.log(`  ✅ [V20] Migrated ${migratedCount} doc(s) for company "${companyData.name}"`);
        }
      }

      return data;
    },
    description: 'Migrate alert/report emails[] → recipients[] (flat union with channel + address)',
  },
  {
    dataVersion: 21,
    schemaVersion: undefined,
    dataMigration: (data: InitData) => {
      // Rename webhook type discriminators:
      //   config docs:  'whatsapp' → 'phone_otp',  'email' → 'email_alert'
      //   alert/report docs:  channel 'email' → 'email_alert',  'whatsapp' → 'phone_alert'

      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents) {
          const content = doc.content as any;
          if (!content) continue;

          if (doc.type === 'config') {
            const webhooks: any[] = content?.messaging?.webhooks;
            if (Array.isArray(webhooks)) {
              for (const w of webhooks) {
                if (w.type === 'whatsapp') w.type = 'phone_otp';
                else if (w.type === 'email') w.type = 'email_alert';
                // Rename {{WHATSAPP_TO}} / {{WHATSAPP_BODY}} template vars in webhook bodies
                if (w.body && typeof w.body === 'object') {
                  const bodyStr = JSON.stringify(w.body)
                    .replace(/\{\{WHATSAPP_TO\}\}/g, '{{PHONE_ALERT_TO}}')
                    .replace(/\{\{WHATSAPP_BODY\}\}/g, '{{PHONE_ALERT_BODY}}');
                  w.body = JSON.parse(bodyStr);
                }
              }
            }
          }

          if (doc.type === 'alert' || doc.type === 'report') {
            const recipients: any[] = content?.recipients;
            if (Array.isArray(recipients)) {
              for (const r of recipients) {
                if (r.channel === 'email') r.channel = 'email_alert';
                else if (r.channel === 'whatsapp') r.channel = 'phone_alert';
              }
            }
          }
        }

        // Rename twofa_whatsapp_enabled → twofa_phone_otp_enabled in user state JSON
        for (const user of companyData.users ?? []) {
          const u = user as any;
          if (u.state) {
            try {
              const state = JSON.parse(u.state);
              if ('twofa_whatsapp_enabled' in state) {
                state.twofa_phone_otp_enabled = state.twofa_whatsapp_enabled;
                delete state.twofa_whatsapp_enabled;
                u.state = JSON.stringify(state);
              }
            } catch { /* leave unparseable state as-is */ }
          }
        }
      }

      return data;
    },
    description: 'Rename webhook type discriminators and identifiers: whatsapp→phone_otp/phone_alert, email→email_alert; {{WHATSAPP_TO/BODY}}→{{PHONE_ALERT_TO/BODY}}; twofa_whatsapp_enabled→twofa_phone_otp_enabled',
  },
  {
    dataVersion: 22,
    schemaVersion: undefined,
    dataMigration: (data: InitData) => {
      // Migrate context evals: EvalItem[] → Test[]
      // Old EvalItem: { question, assertion: BinaryAssertion|NumberAssertion, app_state, connection_id? }
      // New Test: { type: 'llm', subject: { type: 'llm', prompt, context, connection_id? }, answerType, operator, value }

      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents) {
          if (doc.type !== 'context') continue;

          const content = doc.content as any;
          if (!content?.evals || !Array.isArray(content.evals) || content.evals.length === 0) continue;

          // Skip if already migrated — Tests have a 'type' field ('llm'|'query'), EvalItems have 'question'
          if (content.evals[0].type !== undefined) continue;

          const tests: any[] = content.evals.map((item: any) => {
            const assertion = item.assertion;
            let answerType: string;
            let value: any;

            if (assertion?.cannot_answer) {
              answerType = assertion.type === 'binary' ? 'binary' : 'number';
              value = { type: 'cannot_answer' };
            } else if (assertion?.type === 'binary') {
              answerType = 'binary';
              value = { type: 'constant', value: assertion.answer ?? true };
            } else {
              // number_match
              answerType = 'number';
              if (assertion?.question_id) {
                value = { type: 'query', question_id: assertion.question_id, column: assertion.column };
              } else {
                value = { type: 'constant', value: assertion?.answer ?? 0 };
              }
            }

            const subject: any = {
              type: 'llm',
              prompt: item.question ?? '',
              context: item.app_state ?? { type: 'explore' },
            };
            if (item.connection_id) subject.connection_id = item.connection_id;

            return { type: 'llm', subject, answerType, operator: '=', value };
          });

          content.evals = tests;
          console.log(`  [V22] ${doc.path}: Migrated ${tests.length} eval(s) EvalItem → Test`);
        }
      }

      return data;
    },
    description: 'Migrate context evals from EvalItem[] to unified Test[] format',
  },
  {
    dataVersion: 23,
    schemaVersion: undefined,
    dataMigration: (data: InitData) => {
      // Migrate alert files: questionId + AlertCondition → tests: Test[]
      // Old: { questionId: number, condition: { selector, column, function, operator, threshold } }
      // New: { tests: Test[] }

      const validOperators = new Set(['>', '<', '=', '>=', '<=']);

      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents) {
          if (doc.type !== 'alert') continue;

          const content = doc.content as any;
          if (!content) continue;

          // Skip if already migrated
          if (content.tests !== undefined || content.questionId === undefined) continue;

          const questionId: number = content.questionId;
          const condition: any = content.condition;

          if (!questionId || !condition) {
            content.tests = [];
            delete content.questionId;
            delete content.condition;
            continue;
          }

          const row = condition.selector === 'last' ? -1 : 0;
          const operator = validOperators.has(condition.operator) ? condition.operator : '=';

          const test: any = {
            type: 'query',
            subject: {
              type: 'query',
              question_id: questionId,
              ...(condition.column ? { column: condition.column } : {}),
              row,
            },
            answerType: 'number',
            operator,
            value: { type: 'constant', value: condition.threshold ?? 0 },
          };

          // Flag unsupported operator or complex function in label
          if (!validOperators.has(condition.operator)) {
            test.label = `TODO: '${condition.operator}' operator not supported — rewrite this test`;
          } else if (condition.function && condition.function !== 'value' && condition.function !== 'count') {
            test.label = `TODO: rewrite query for '${condition.function}' function`;
          }

          content.tests = [test];
          delete content.questionId;
          delete content.condition;
          console.log(`  [V23] ${doc.path}: Migrated alert condition to tests[]`);
        }
      }

      return data;
    },
    description: 'Migrate alert files: questionId + AlertCondition → tests: Test[]',
  },
  {
    dataVersion: 24,
    schemaVersion: undefined,
    dataMigration: (data: InitData) => {
      // For each stored config document:
      // 1. Replace the old default Slack HTTP webhook template with the SLACK_DEFAULT keyword
      // 2. Add EMAIL_DEFAULT keyword for email_alert and email_otp if not already configured
      //
      // Only operates on the messaging.webhooks array when it is explicitly stored in the DB.
      // Config docs with no messaging section are unaffected — they get DEFAULT_CONFIG at load time.

      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents) {
          if (doc.type !== 'config') continue;
          const content = doc.content as any;
          if (!content || !Array.isArray(content?.messaging?.webhooks)) continue;

          const webhooks: any[] = content.messaging.webhooks;
          let changed = false;

          // 1. Replace old default Slack HTTP template with SLACK_DEFAULT keyword
          for (let i = 0; i < webhooks.length; i++) {
            const w = webhooks[i];
            if (
              w.type === 'slack_alert' &&
              w.url === '{{SLACK_WEBHOOK}}' &&
              w.method === 'POST' &&
              w.body === '{{SLACK_PROPERTIES}}'
            ) {
              webhooks[i] = { type: 'slack_alert', keyword: 'SLACK_DEFAULT' };
              changed = true;
            }
          }

          // 2. Add EMAIL_DEFAULT for email_alert if missing
          if (!webhooks.some((w: any) => w.type === 'email_alert')) {
            webhooks.push({ type: 'email_alert', keyword: 'EMAIL_DEFAULT' });
            changed = true;
          }

          // 3. Add EMAIL_DEFAULT for email_otp if missing
          if (!webhooks.some((w: any) => w.type === 'email_otp')) {
            webhooks.push({ type: 'email_otp', keyword: 'EMAIL_DEFAULT' });
            changed = true;
          }

          if (changed) {
            console.log(`  [V24] ${doc.path}: Migrated webhook config to keyword format`);
          }
        }
      }

      return data;
    },
    description: 'Replace old Slack HTTP template with SLACK_DEFAULT keyword; add EMAIL_DEFAULT keyword for missing email_alert and email_otp webhooks in stored config docs',
  },
  {
    dataVersion: 25,
    schemaVersion: undefined,
    dataMigration: (data: InitData) => {
      // Mark all existing org/internals config docs as onboarding complete.
      // Existing companies have already completed onboarding (they have real data).
      // New companies get setupWizard.status = 'pending' from company-template.json instead.
      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents) {
          if (doc.type !== 'config') continue;
          if (!doc.path.endsWith('/configs/config')) continue;
          const content = doc.content as any;
          if (!content) continue;
          if (!content.setupWizard) {
            content.setupWizard = { status: 'complete' };
          }
        }
      }
      return data;
    },
    description: 'Set setupWizard.status = "complete" on all existing /org/configs/config documents (existing companies have already completed onboarding)',
  },
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
        if (viz?.colors && !viz?.styleConfig?.colors) {
          viz.styleConfig = {
            ...(viz.styleConfig ?? {}),
            colors: viz.colors,
          };
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
