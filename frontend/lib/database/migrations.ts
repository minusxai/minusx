/**
 * Database migration registry and utilities
 * Supports both data format migrations and schema changes
 */

import { InitData, CompanyData, ExportedDocument } from './import-export';
import { LATEST_DATA_VERSION, LATEST_SCHEMA_VERSION } from './constants';
import { DEFAULT_STYLES } from '@/lib/branding/whitelabel';
import { VALID_MODES } from '@/lib/mode/mode-types';

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
  {
    dataVersion: 26,
    description: 'V26: Fix files with broken paths by moving them to the nearest valid ancestor folder',
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        fixFilesWithBrokenPaths(companyData);
      }
      return data;
    },
  },
  {
    dataVersion: 27,
    description: 'V27: Ensure system folders exist under mode roots; relocate misplaced config/styles/connection files',
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        fixSystemFolderPlacement(companyData);
      }
      return data;
    },
  },
  {
    dataVersion: 28,
    description: 'V28: Rename /<mode>/config folders to /<mode>/configs (fix v26/v27 naming bug)',
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        renameConfigToConfigs(companyData);
      }
      return data;
    },
  },
  {
    dataVersion: 29,
    description: 'V29: Rename database_name → connection_name in question and dashboard content',
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents as ExportedDocument[]) {
          if ((doc.type === 'question' || doc.type === 'dashboard') && doc.content && typeof doc.content === 'object') {
            const content = doc.content as any;
            if ('database_name' in content && !('connection_name' in content)) {
              content.connection_name = content.database_name;
              delete content.database_name;
            }
          }
        }
      }
      return data;
    },
  },
  {
    dataVersion: 30,
    description: 'V30: Normalize alert recipients from raw addresses to userId/channelName references',
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        // Build email→userId and phone→userId lookup maps from this company's users
        const emailToUserId = new Map<string, number>();
        const phoneToUserId = new Map<string, number>();
        for (const user of companyData.users as any[]) {
          if (user.id == null) continue;
          if (user.email) emailToUserId.set(user.email.toLowerCase(), user.id);
          if (user.phone) phoneToUserId.set(user.phone, user.id);
        }

        for (const doc of companyData.documents as ExportedDocument[]) {
          if (doc.type !== 'alert' && doc.type !== 'report') continue;
          const content = doc.content as any;
          if (!content || !Array.isArray(content.recipients)) continue;

          const migrated: any[] = [];
          for (const r of content.recipients) {
            // Skip recipients already in new shape (has userId or channelName)
            if ('userId' in r || 'channelName' in r) {
              migrated.push(r);
              continue;
            }
            const { channel, address } = r as { channel: string; address: string };
            if (channel === 'email_alert') {
              const userId = emailToUserId.get((address ?? '').toLowerCase());
              migrated.push(userId != null
                ? { userId, channel: 'email' }
                : { channelName: address, channel: 'email' });
            } else if (channel === 'phone_alert') {
              const userId = phoneToUserId.get(address ?? '');
              migrated.push(userId != null
                ? { userId, channel: 'phone' }
                : { channelName: address, channel: 'phone' });
            } else if (channel === 'slack_alert') {
              migrated.push({ channelName: address, channel: 'slack' });
            } else {
              // Unknown channel type — keep as-is to avoid data loss
              migrated.push(r);
            }
          }
          content.recipients = migrated;
        }
      }
      return data;
    },
  },
  {
    dataVersion: 31,
    description: 'V31: Add conversation and config to accessRules.admin.createTypes in config overrides',
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents as ExportedDocument[]) {
          if (doc.type !== 'config') continue;
          const content = doc.content as any;
          if (!content || typeof content !== 'object') continue;
          const createTypes = content?.accessRules?.admin?.createTypes;
          if (!Array.isArray(createTypes)) continue;
          for (const type of ['conversation', 'config'] as const) {
            if (!createTypes.includes(type)) createTypes.push(type);
          }
        }
      }
      return data;
    },
  },
  {
    dataVersion: 32,
    description: 'V32: Normalize dashboard layout item IDs — old data stored FileReference objects {type,id}; coerce to integer or drop',
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents as ExportedDocument[]) {
          if (doc.type !== 'dashboard') continue;
          const content = doc.content as any;
          if (!content?.layout?.items || !Array.isArray(content.layout.items)) continue;

          const normalized: any[] = [];
          for (const item of content.layout.items) {
            let id = item.id;
            // Coerce FileReference objects { type: 'question', id: N } → integer
            if (id !== null && typeof id === 'object' && typeof id.id === 'number') {
              id = id.id;
            }
            // Keep only items whose id is an integer or non-empty string
            if (typeof id === 'number' && Number.isInteger(id)) {
              normalized.push({ ...item, id });
            } else if (typeof id === 'string' && id.length > 0) {
              normalized.push({ ...item, id });
            }
            // else: null / undefined / object / empty string → drop the item
          }
          content.layout.items = normalized;
        }
      }
      return data;
    },
  },
  {
    dataVersion: 33,
    description: 'V33: Strip generated_db_path from CSV connection configs (CSV now uses S3-backed files array only)',
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents as ExportedDocument[]) {
          if (doc.type !== 'connection') continue;
          const content = doc.content as any;
          if (!content || content.type !== 'csv') continue;
          if ('generated_db_path' in content.config) {
            delete content.config.generated_db_path;
            console.log(`  [V33] ${doc.path}: Removed generated_db_path from CSV connection config`);
          }
        }
      }
      return data;
    },
  },
  {
    dataVersion: 34,
    description: 'V34: Strip generated_db_path from Google Sheets connection configs (Google Sheets now uses S3-backed files array only)',
    dataMigration: (data: InitData) => {
      for (const companyData of data.companies as CompanyData[]) {
        for (const doc of companyData.documents as ExportedDocument[]) {
          if (doc.type !== 'connection') continue;
          const content = doc.content as any;
          if (!content || content.type !== 'google-sheets') continue;
          if ('generated_db_path' in content.config) {
            delete content.config.generated_db_path;
            console.log(`  [V34] ${doc.path}: Removed generated_db_path from Google Sheets connection config`);
          }
        }
      }
      return data;
    },
  },
];

/**
 * For every document in a company whose path is invalid (missing parent folder, or sitting at
 * a root segment that is not a recognised mode), relocate it to the deepest valid ancestor
 * folder that has a free slot. Falls back to /org (with numeric suffix) when no ancestor exists.
 * config/styles files are redirected to /<mode>/config and connection files to /<mode>/database
 * rather than landing directly in the mode root. Paths starting with /logs are left untouched.
 * For folders, all descendants are cascade-updated before the folder itself is moved.
 * Mutates companyData.documents in place.
 */
export function fixFilesWithBrokenPaths(companyData: CompanyData): void {
  const folderPaths = new Set<string>(
    companyData.documents.filter(d => d.type === 'folder').map(d => d.path)
  );
  const allPaths = new Set<string>(companyData.documents.map(d => d.path));

  // Process shallowest-first: a moved folder's new path is registered in folderPaths
  // before we reach any of its children, so children resolve correctly in one pass.
  companyData.documents.sort(
    (a, b) => a.path.split('/').filter(Boolean).length - b.path.split('/').filter(Boolean).length
  );

  const validModeRoots = new Set<string>(VALID_MODES.map(m => `/${m}`));

  // Ensure system subfolders exist under every present mode root so the redirect
  // logic below always has a valid destination folder to target.
  ensureSystemFolders(companyData, validModeRoots, folderPaths, allPaths);

  for (const doc of companyData.documents) {
    // Conversation logs and other /logs paths must never be relocated.
    if (doc.path.startsWith('/logs')) continue;

    const parts = doc.path.split('/').filter(Boolean);

    if (parts.length === 0) continue; // empty path — unrecoverable, skip

    if (parts.length === 1) {
      // Root-level: valid only when it is a folder at a recognised mode root (/org, /tutorial, /internals)
      if (doc.type === 'folder' && validModeRoots.has(doc.path)) continue;
      // Otherwise fall through — ancestor walk finds nothing, hitting the /org fallback
    } else {
      const parentPath = '/' + parts.slice(0, -1).join('/');
      if (folderPaths.has(parentPath)) continue; // parent exists — no fix needed
    }

    const fileName = parts[parts.length - 1];

    // Walk up from the immediate parent toward the root, looking for the deepest
    // valid folder that has an unoccupied slot for this file name.
    let newPath: string | null = null;
    for (let i = parts.length - 2; i >= 1; i--) {
      const ancestorPath = '/' + parts.slice(0, i).join('/');
      if (!folderPaths.has(ancestorPath)) continue;
      const candidatePath = ancestorPath + '/' + fileName;
      if (!allPaths.has(candidatePath)) {
        newPath = candidatePath;
        break;
      }
      // Slot taken at this level — continue searching a higher ancestor
    }

    if (newPath === null) {
      // Absolute fallback to /org with numeric suffix for collisions
      const fallback = '/org';
      if (folderPaths.has(fallback)) {
        let candidate = fallback + '/' + fileName;
        let suffix = 1;
        while (allPaths.has(candidate)) {
          candidate = `${fallback}/${fileName}_${++suffix}`;
        }
        newPath = candidate;
      }
    }

    if (newPath === null) continue; // /org doesn't exist either — truly unresolvable

    // If the resolved path lands directly in a mode root, redirect system-typed files
    // to the appropriate subfolder (config/styles → /config, connection → /database).
    const newParts = newPath.split('/').filter(Boolean);
    const newParent = '/' + newParts.slice(0, -1).join('/');
    if (validModeRoots.has(newParent)) {
      const sub = getSystemSubfolder(doc.type);
      if (sub !== null) {
        const subfolderPath = `${newParent}/${sub}`;
        let redirected = `${subfolderPath}/${fileName}`;
        let suffix = 1;
        while (allPaths.has(redirected)) {
          redirected = `${subfolderPath}/${fileName}_${++suffix}`;
        }
        newPath = redirected;
      }
    }

    // For folders: cascade path update to all descendants before moving self
    if (doc.type === 'folder') {
      const oldPrefix = doc.path + '/';
      for (const other of companyData.documents) {
        if (other.path.startsWith(oldPrefix)) {
          const updatedPath = newPath + '/' + other.path.slice(oldPrefix.length);
          allPaths.delete(other.path);
          allPaths.add(updatedPath);
          if (other.type === 'folder') {
            folderPaths.delete(other.path);
            folderPaths.add(updatedPath);
          }
          other.path = updatedPath;
        }
      }
      folderPaths.delete(doc.path);
      folderPaths.add(newPath);
    }

    allPaths.delete(doc.path);
    allPaths.add(newPath);
    doc.path = newPath;
  }
}

/**
 * Ensures config/, database/, and logs/ subfolders exist under every mode root
 * that is present in companyData. Creates missing folder documents in place and
 * registers them in the provided folderPaths / allPaths sets.
 */
function ensureSystemFolders(
  companyData: CompanyData,
  validModeRoots: Set<string>,
  folderPaths: Set<string>,
  allPaths: Set<string>,
): void {
  for (const modeRoot of validModeRoots) {
    if (!folderPaths.has(modeRoot)) continue;
    for (const sub of ['configs', 'database', 'logs']) {
      const subPath = `${modeRoot}/${sub}`;
      if (allPaths.has(subPath)) continue; // already occupied by any document type
      const folder = createFolderDoc(companyData, subPath);
      companyData.documents.push(folder);
      folderPaths.add(subPath);
      allPaths.add(subPath);
    }
  }
}

/** Returns the system subfolder name for file types that must not land in a mode root. */
function getSystemSubfolder(docType: string): string | null {
  if (docType === 'config' || docType === 'styles') return 'configs';
  if (docType === 'connection') return 'database';
  return null;
}

/** Creates a new folder document using the max-id+1 strategy. */
function createFolderDoc(companyData: CompanyData, path: string): ExportedDocument {
  const maxId = companyData.documents.reduce((max, d) => Math.max(max, d.id), 0);
  const now = new Date().toISOString();
  return {
    id: maxId + 1,
    name: path.split('/').filter(Boolean).pop()!,
    path,
    type: 'folder' as const,
    references: [],
    content: {},
    company_id: companyData.id,
    created_at: now,
    updated_at: now,
    version: 1,
    last_edit_id: null,
  };
}

/**
 * Ensures system subfolders (config, database, logs) exist under every mode root,
 * relocates any config/styles/connection files sitting directly in a mode root to
 * the appropriate subfolder, and normalizes any double (or repeated) slashes in
 * all document paths. Paths starting with /logs are never touched.
 * Mutates companyData.documents in place.
 */
export function fixSystemFolderPlacement(companyData: CompanyData): void {
  const folderPaths = new Set<string>(
    companyData.documents.filter(d => d.type === 'folder').map(d => d.path)
  );
  const allPaths = new Set<string>(companyData.documents.map(d => d.path));
  const validModeRoots = new Set<string>(VALID_MODES.map(m => `/${m}`));

  // Step 1: create system subfolders under all existing mode roots
  ensureSystemFolders(companyData, validModeRoots, folderPaths, allPaths);

  // Step 2: relocate any system-typed files sitting directly in a mode root
  for (const doc of companyData.documents) {
    if (doc.path.startsWith('/logs')) continue;

    const parts = doc.path.split('/').filter(Boolean);
    if (parts.length !== 2) continue; // only files sitting directly in a mode root

    const parent = `/${parts[0]}`;
    if (!validModeRoots.has(parent)) continue;

    const sub = getSystemSubfolder(doc.type);
    if (sub === null) continue;

    const fileName = parts[1];
    let newPath = `${parent}/${sub}/${fileName}`;
    let suffix = 1;
    while (allPaths.has(newPath)) {
      newPath = `${parent}/${sub}/${fileName}_${++suffix}`;
    }

    allPaths.delete(doc.path);
    allPaths.add(newPath);
    doc.path = newPath;
  }

  // Step 3: normalize double (or repeated) slashes in all paths, e.g. /org//report → /org/report.
  // Process shallowest-first so folder renames cascade correctly to children.
  companyData.documents.sort(
    (a, b) => a.path.split('/').filter(Boolean).length - b.path.split('/').filter(Boolean).length
  );
  for (const doc of companyData.documents) {
    if (doc.path.startsWith('/logs')) continue;

    const normalized = doc.path.replace(/\/+/g, '/');
    if (normalized === doc.path) continue;

    // Resolve collision: if another doc already occupies the normalized path, append suffix
    const namePart = normalized.split('/').filter(Boolean).pop()!;
    const parentPart = normalized.slice(0, normalized.lastIndexOf('/') + 1);
    let candidate = normalized;
    let suffix = 1;
    while (allPaths.has(candidate)) {
      candidate = `${parentPart}${namePart}_${++suffix}`;
    }

    // For folders: cascade the rename to all descendants before updating self
    if (doc.type === 'folder') {
      const oldPrefix = doc.path + '/';
      const newPrefix = candidate + '/';
      for (const other of companyData.documents) {
        if (other.path.startsWith(oldPrefix)) {
          const updatedPath = newPrefix + other.path.slice(oldPrefix.length);
          allPaths.delete(other.path);
          allPaths.add(updatedPath);
          if (other.type === 'folder') {
            folderPaths.delete(other.path);
            folderPaths.add(updatedPath);
          }
          other.path = updatedPath;
        }
      }
      folderPaths.delete(doc.path);
      folderPaths.add(candidate);
    }

    allPaths.delete(doc.path);
    allPaths.add(candidate);
    doc.path = candidate;
  }
}

/**
 * For each mode root, renames any /<mode>/config folder (created with the wrong name
 * by v26/v27) to /<mode>/configs. If /<mode>/configs already exists, children of the
 * wrong folder are merged into it (with suffix on collision) and the empty wrong folder
 * is removed. Mutates companyData.documents in place.
 */
export function renameConfigToConfigs(companyData: CompanyData): void {
  const folderPaths = new Set<string>(
    companyData.documents.filter(d => d.type === 'folder').map(d => d.path)
  );
  const allPaths = new Set<string>(companyData.documents.map(d => d.path));
  const validModeRoots = new Set<string>(VALID_MODES.map(m => `/${m}`));

  for (const modeRoot of validModeRoots) {
    const wrongPath = `${modeRoot}/config`;
    const rightPath = `${modeRoot}/configs`;

    if (!folderPaths.has(wrongPath)) continue; // no wrongly-named folder — nothing to do

    if (!allPaths.has(rightPath)) {
      // Simple rename: cascade all children, then rename the folder itself.
      const oldPrefix = wrongPath + '/';
      const newPrefix = rightPath + '/';
      for (const doc of companyData.documents) {
        if (doc.path.startsWith(oldPrefix)) {
          const updated = newPrefix + doc.path.slice(oldPrefix.length);
          allPaths.delete(doc.path);
          allPaths.add(updated);
          if (doc.type === 'folder') {
            folderPaths.delete(doc.path);
            folderPaths.add(updated);
          }
          doc.path = updated;
          doc.name = updated.split('/').filter(Boolean).pop()!;
        }
      }
      const folder = companyData.documents.find(d => d.path === wrongPath);
      if (folder) {
        allPaths.delete(wrongPath);
        allPaths.add(rightPath);
        folderPaths.delete(wrongPath);
        folderPaths.add(rightPath);
        folder.path = rightPath;
        folder.name = 'configs';
      }
    } else {
      // /<mode>/configs already exists — merge children of /<mode>/config into it,
      // then delete the now-empty wrong folder.
      const oldPrefix = wrongPath + '/';

      // Process shallowest-first so that when a subfolder is renamed (possibly with a
      // collision suffix), its children are cascaded immediately before we encounter
      // them — preventing them from being placed under the pre-suffix path.
      const toMerge = companyData.documents
        .filter(d => d.path.startsWith(oldPrefix))
        .sort((a, b) => a.path.split('/').length - b.path.split('/').length);

      for (const doc of toMerge) {
        // If an ancestor folder was already renamed and cascaded, this doc's path was
        // updated to the new prefix — skip it, it's already in the right place.
        if (!doc.path.startsWith(oldPrefix)) continue;

        const relPath = doc.path.slice(oldPrefix.length);
        const namePart = relPath.split('/').pop()!;
        const relParent = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
        const parentNew = relParent ? `${rightPath}/${relParent}` : rightPath;
        let candidate = `${parentNew}/${namePart}`;
        let suffix = 1;
        while (allPaths.has(candidate)) {
          candidate = `${parentNew}/${namePart}_${++suffix}`;
        }

        // For folders: cascade the rename to all descendants before updating self,
        // so that children already have the correct new prefix when we reach them.
        if (doc.type === 'folder') {
          const childOldPrefix = doc.path + '/';
          const childNewPrefix = candidate + '/';
          for (const other of companyData.documents) {
            if (other.path.startsWith(childOldPrefix)) {
              const updatedPath = childNewPrefix + other.path.slice(childOldPrefix.length);
              allPaths.delete(other.path);
              allPaths.add(updatedPath);
              if (other.type === 'folder') {
                folderPaths.delete(other.path);
                folderPaths.add(updatedPath);
              }
              other.path = updatedPath;
              other.name = updatedPath.split('/').filter(Boolean).pop()!;
            }
          }
          folderPaths.delete(doc.path);
          folderPaths.add(candidate);
        }

        allPaths.delete(doc.path);
        allPaths.add(candidate);
        doc.path = candidate;
        doc.name = candidate.split('/').filter(Boolean).pop()!;
      }

      // Remove the wrong folder document itself.
      const idx = companyData.documents.findIndex(
        d => d.path === wrongPath && d.type === 'folder'
      );
      if (idx !== -1) {
        companyData.documents.splice(idx, 1);
        allPaths.delete(wrongPath);
        folderPaths.delete(wrongPath);
      }
    }
  }
}

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
