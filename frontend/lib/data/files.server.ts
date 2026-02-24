import 'server-only';
import { DocumentDB, AccessTokenDB } from '@/lib/database/documents-db';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { DbFile, BaseFileContent, FileType, QuestionContent, DocumentContent, ConnectionContent, ContextContent, ReportContent, AlertContent } from '@/lib/types';
import { IFilesDataLayer } from './files.interface';
import {
  LoadFileResult,
  LoadFilesResult,
  GetFilesOptions,
  GetFilesResult,
  SaveFileResult,
  CreateFileInput,
  CreateFileResult,
  FileInfo,
  GetTemplateOptions,
  GetTemplateResult,
  BatchCreateInput,
  BatchCreateFileResult,
  BatchSaveFileInput,
  BatchSaveFileResult
} from './types';
import { canAccessFile } from './helpers/permissions';
import { extractReferenceIds, extractAllReferenceIds } from './helpers/references';
import { AccessPermissionError, FileNotFoundError } from '@/lib/errors';
import { PROTECTED_FILE_PATHS } from '@/lib/constants';
import { canAccessFileType, canCreateFileType, validateFileLocation } from '@/lib/auth/access-rules';
import type { AccessRulesOverride } from '@/lib/branding/whitelabel';
import { getConfigsByCompanyId } from './configs.server';
import { resolvePath, resolveHomeFolderSync, isFileTypeAllowedInPath, resolveHomeFolder } from '@/lib/mode/path-resolver';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getLoader, LoaderOptions } from './loaders';
import { listAllConnections } from './connections.server';
import { computeSchemaFromDatabases } from './loaders/context-loader-utils';
import { selectDatabase } from '@/lib/utils/database-selector';
import { getQueryHash } from '@/lib/utils/query-hash';

/**
 * Server-side implementation of files data layer
 * Uses direct database access with permission checks
 *
 * NOTE: Token scope validation is handled at the route level (/t/[token]/page.tsx)
 * and in getEffectiveUserFromToken()
 */
class FilesDataLayerServer implements IFilesDataLayer {
  /**
   * Load access rules overrides from company config (cached per-company by configs layer)
   */
  private async _getOverrides(user: EffectiveUser): Promise<AccessRulesOverride | undefined> {
    try {
      const { config } = await getConfigsByCompanyId(user.companyId, user.mode);
      return config.accessRules;
    } catch {
      return undefined;
    }
  }

  async loadFile(id: number, user: EffectiveUser, options?: LoaderOptions): Promise<LoadFileResult> {
    const dbStart = Date.now();
    const file = await DocumentDB.getById(id, user.companyId);
    console.log(`[FILES DataLayer] DocumentDB.getById took ${Date.now() - dbStart}ms`);

    if (!file) {
      throw new FileNotFoundError(id);
    }

    // Load config-based access rule overrides once per request
    const overrides = await this._getOverrides(user);

    // Check file access (unified: type + mode + path) - Phase 4
    console.log(`[FILES DataLayer] Checking access for user:`, {
      email: user.email,
      user_companyId: user.companyId,
      file_companyId: file.company_id,
      role: user.role,
      fileType: file.type,
      fileId: id
    });

    if (!canAccessFile(file, user, overrides)) {
      throw new AccessPermissionError('You do not have permission to access this file');
    }

    const refStart = Date.now();
    const refIds = await extractReferenceIds(file);
    const references = refIds.length > 0
      ? await DocumentDB.getByIds(refIds, user.companyId)
      : [];
    console.log(`[FILES DataLayer] Loading ${refIds.length} references took ${Date.now() - refStart}ms`);

    // Filter references by unified permission check (Phase 4)
    const filteredReferences = references.filter(ref => canAccessFile(ref, user, overrides));

    // Apply custom loaders AFTER permission checks (Phase 3)
    const loaderStart = Date.now();
    const loader = getLoader(file.type);
    const transformedFile = await loader(file, user, options);

    const transformedReferences = await Promise.all(
      filteredReferences.map(async (ref) => {
        const refLoader = getLoader(ref.type);
        return refLoader(ref, user, options);
      })
    );
    console.log(`[FILES DataLayer] Custom loaders took ${Date.now() - loaderStart}ms`);

    return {
      data: transformedFile,
      metadata: { references: transformedReferences }
    };
  }

  async loadFiles(ids: number[], user: EffectiveUser, options?: LoaderOptions): Promise<LoadFilesResult> {
    const files = await DocumentDB.getByIds(ids, user.companyId);
    const overrides = await this._getOverrides(user);

    // Filter by unified permission check (Phase 4)
    const filteredFiles = files.filter(f => canAccessFile(f, user, overrides));

    const uniqueRefIds = await extractAllReferenceIds(filteredFiles);
    const references = uniqueRefIds.length > 0
      ? await DocumentDB.getByIds(uniqueRefIds, user.companyId)
      : [];

    // Filter references by unified permission check (Phase 4)
    const filteredReferences = references.filter(ref => canAccessFile(ref, user, overrides));

    // Apply loaders AFTER permission checks (Phase 3)
    const transformedFiles = await Promise.all(
      filteredFiles.map(async (file) => {
        const loader = getLoader(file.type);
        return loader(file, user, options);
      })
    );

    const transformedReferences = await Promise.all(
      filteredReferences.map(async (ref) => {
        const refLoader = getLoader(ref.type);
        return refLoader(ref, user, options);
      })
    );

    return {
      data: transformedFiles,
      metadata: { references: transformedReferences }
    };
  }

  async getFiles(options: GetFilesOptions, user: EffectiveUser): Promise<GetFilesResult> {
    const { paths = [], type, depth = 1 } = options;

    // Pass path filters and depth to database for SQL-level filtering
    // Phase 6: Skip content loading for performance - references are cached in DB column
    let files = await DocumentDB.listAll(
      user.companyId,
      type,
      paths.length > 0 ? paths : undefined,
      depth,
      false  // includeContent: false - 50-80% faster!
    );

    const overrides = await this._getOverrides(user);

    // Apply unified permission filter (Phase 4)
    files = files.filter(f => canAccessFile(f, user, overrides));

    // Apply loaders AFTER permission checks (Phase 3)
    files = await Promise.all(
      files.map(async (file) => {
        const loader = getLoader(file.type);
        return loader(file, user);
      })
    );

    // Get folder files for pathIndex
    const folderFiles = paths.length > 0
      ? paths.map(p => files.find(f => f.path === p && f.type === 'folder')).filter((f): f is DbFile => f !== undefined)
      : [];

    const fileInfos: FileInfo[] = await Promise.all(files.map(async file => ({
      id: file.id,
      name: file.name,
      path: file.path,
      type: file.type,
      references: await extractReferenceIds(file),
      created_at: file.created_at,
      updated_at: file.updated_at,
      company_id: file.company_id
    })));

    const folderInfos: FileInfo[] = folderFiles.map(file => ({
      id: file.id,
      name: file.name,
      path: file.path,
      type: file.type,
      references: [],
      created_at: file.created_at,
      updated_at: file.updated_at,
      company_id: file.company_id
    }));

    return {
      data: fileInfos,
      metadata: { folders: folderInfos }
    };
  }

  async createFile(input: CreateFileInput, user: EffectiveUser): Promise<CreateFileResult> {
    const { name, path, type, content, references = [], options } = input;
    const overrides = await this._getOverrides(user);

    // Check file type access
    if (!canAccessFileType(user.role, type, overrides)) {
      throw new AccessPermissionError(`You do not have permission to create files of type: ${type}`);
    }

    // Check if type can be manually created (blocks config/styles universally)
    if (!canCreateFileType(type)) {
      throw new AccessPermissionError(
        `Files of type '${type}' cannot be manually created. They are system-managed.`
      );
    }

    // Validate location restrictions (e.g., questions in /org, connections in /database)
    // Path is already physical (mode-resolved), mode is used to resolve rule prefixes
    try {
      validateFileLocation(type, path, user.mode);
    } catch (error) {
      throw new AccessPermissionError((error as Error).message);
    }

    // Check if path is protected
    if (PROTECTED_FILE_PATHS.includes(path as any)) {
      throw new AccessPermissionError(`Cannot create file at protected path: ${path}`);
    }

    // Redirect from system folders if file type not allowed there
    let finalPath = path;
    if (!isFileTypeAllowedInPath(type, path, user.mode)) {
      // File type not allowed in system folder - redirect to user's home folder
      const fileName = name || path.split('/').pop() || 'untitled';
      const homeFolder = await resolveHomeFolder(
        user.mode,
        user.home_folder || '',
        async (checkPath) => {
          const exists = await DocumentDB.getByPath(checkPath, user.companyId);
          return exists !== null;
        }
      );
      finalPath = `${homeFolder}/${fileName}`;

      console.log(`[FilesAPI.create] Redirected ${type} from system folder to home folder:`, {
        originalPath: path,
        redirectedPath: finalPath
      });
    }

    // Check if user has access to the target path (mode-aware)
    // Non-admin users (editor/viewer) can only create in:
    // - Their home folder (already physical path with mode prefix)
    // - Their user conversation folder (needs mode resolution)
    if (!isAdmin(user.role)) {
      const userId = user.userId?.toString() || user.email;
      const userConversationFolder = resolvePath(user.mode, `/logs/conversations/${userId}`);

      // Resolve home folder with mode (user.home_folder is relative path like 'sales/team1')
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
      const canCreateInHomeFolder = finalPath.startsWith(resolvedHomeFolder);
      const canCreateInConversationFolder = finalPath.startsWith(userConversationFolder);

      if (!canCreateInHomeFolder && !canCreateInConversationFolder) {
        throw new AccessPermissionError('You can only create files in your home folder or conversation folder');
      }
    }

    // Handle returnExisting option: return existing file if path exists
    if (options?.returnExisting) {
      const existingFile = await DocumentDB.getByPath(finalPath, user.companyId);
      if (existingFile) {
        return { data: existingFile };
      }
    }

    // Handle createPath option: create parent directories as folder types
    if (options?.createPath) {
      const pathSegments = finalPath.split('/').filter(Boolean);
      let currentPath = '';

      // Create each parent folder if it doesn't exist
      for (let i = 0; i < pathSegments.length - 1; i++) {
        currentPath += '/' + pathSegments[i];
        const folderExists = await DocumentDB.getByPath(currentPath, user.companyId);

        if (!folderExists) {
          await DocumentDB.create(
            pathSegments[i],
            currentPath,
            'folder',
            { name: pathSegments[i] },
            [],  // Phase 6: Folders have no references
            user.companyId
          );
        }
      }
    }

    // For questions: compute and store queryResultId
    let contentToCreate = content;
    if (type === 'question') {
      const questionContent = content as QuestionContent;
      // Build params object from parameter values
      const params = (questionContent.parameters || []).reduce((acc, p) => {
        acc[p.name] = p.defaultValue ?? '';
        return acc;
      }, {} as Record<string, any>);
      // Compute hash and add to content
      const queryResultId = getQueryHash(questionContent.query, params, questionContent.database_name);
      contentToCreate = { ...contentToCreate, queryResultId } as BaseFileContent;
      console.log(`[FILES DataLayer] Computed queryResultId for new question ${name}: ${queryResultId}`);
    }

    // Create file in database (returns numeric ID)
    // Phase 6: Pass references from client (server is dumb, no extraction)
    const newFileId = await DocumentDB.create(name, finalPath, type, contentToCreate, references, user.companyId);

    if (!newFileId) {
      throw new Error('Failed to create file');
    }

    // Fetch the newly created file
    const newFile = await DocumentDB.getById(newFileId, user.companyId);

    if (!newFile) {
      throw new Error('File not found after creation');
    }

    return {
      data: newFile
    };
  }

  async saveFile(id: number, name: string, path: string, content: BaseFileContent, references: number[], user: EffectiveUser): Promise<SaveFileResult> {
    // Get existing file
    const existingFile = await DocumentDB.getById(id, user.companyId);

    if (!existingFile) {
      throw new FileNotFoundError(id);
    }

    const overrides = await this._getOverrides(user);

    // Check file access (unified: type + mode + path) - Phase 4
    if (!canAccessFile(existingFile, user, overrides)) {
      throw new AccessPermissionError('You do not have permission to modify this file');
    }

    // Check if path is protected
    if (PROTECTED_FILE_PATHS.includes(path as any)) {
      throw new AccessPermissionError(`Cannot modify file at protected path: ${path}`);
    }

    // Strip server-managed fields from client content before saving
    let contentToSave = content;

    // For connections: strip schema (server-managed field)
    if (existingFile.type === 'connection') {
      const { schema, ...connectionContentWithoutSchema } = content as ConnectionContent;
      contentToSave = connectionContentWithoutSchema as BaseFileContent;
      console.log(`[FILES DataLayer] Stripped schema from client content for connection ${name}`);
    }

    // For contexts: strip fullSchema and fullDocs (server-computed fields)
    if (existingFile.type === 'context') {
      const { fullSchema, fullDocs, ...contextContentWithoutComputed } = content as ContextContent;
      contentToSave = contextContentWithoutComputed as BaseFileContent;
      console.log(`[FILES DataLayer] Stripped fullSchema and fullDocs from client content for context ${name}`);
    }

    // For questions: compute and store queryResultId
    if (existingFile.type === 'question') {
      const questionContent = content as QuestionContent;
      // Build params object from parameter values
      const params = (questionContent.parameters || []).reduce((acc, p) => {
        acc[p.name] = p.defaultValue ?? '';
        return acc;
      }, {} as Record<string, any>);
      // Compute hash and add to content
      const queryResultId = getQueryHash(questionContent.query, params, questionContent.database_name);
      contentToSave = { ...contentToSave, queryResultId } as BaseFileContent;
      console.log(`[FILES DataLayer] Computed queryResultId for question ${name}: ${queryResultId}`);
    }

    // Phase 6: Server is dumb - just saves what client sends (no extraction)
    const success = await DocumentDB.update(id, name, path, contentToSave, references, user.companyId);

    if (!success) {
      throw new Error('Failed to save file');
    }

    // For connections, reload through loader with refresh=true to update schema
    if (existingFile.type === 'connection') {
      console.log(`[FILES DataLayer] Connection saved, refreshing schema for ${name}`);
      return this.loadFile(id, user, { refresh: true });
    }

    // For contexts, reload through loader to recompute fullSchema and fullDocs
    if (existingFile.type === 'context') {
      console.log(`[FILES DataLayer] Context saved, recomputing fullSchema and fullDocs for ${name}`);
      return this.loadFile(id, user, { refresh: true });
    }

    // For other types, fetch updated file normally
    const updatedFile = await DocumentDB.getById(id, user.companyId);

    if (!updatedFile) {
      throw new Error('File not found after update');
    }

    return {
      data: updatedFile
    };
  }

  async loadFileByPath(path: string, user: EffectiveUser, options?: LoaderOptions): Promise<LoadFileResult> {
    const file = await DocumentDB.getByPath(path, user.companyId);

    if (!file) {
      throw new FileNotFoundError(`File not found at path: ${path}`);
    }

    const overrides = await this._getOverrides(user);

    // Check file access (unified: type + mode + path) - Phase 4
    if (!canAccessFile(file, user, overrides)) {
      throw new AccessPermissionError('You do not have permission to access this file');
    }

    // Apply loader
    const loader = getLoader(file.type);
    const transformedFile = await loader(file, user, options);

    // Return in LoadFileResult format (without references for now)
    return {
      data: transformedFile,
      metadata: {
        references: []
      }
    };
  }

  async getTemplate(type: FileType, options: GetTemplateOptions, user: EffectiveUser): Promise<GetTemplateResult> {
    switch (type) {
      case 'question': {
        // Load connections to suggest default database
        const { connections } = await listAllConnections(user, false);
        const databaseNames = connections.map(c => c.name);
        const databaseConnections = connections.map(c => ({ metadata: { name: c.name } }));
        // Use centralized database selection logic (returns empty string if no connections)
        const defaultDb = selectDatabase(databaseConnections, options.databaseName);

        // Validate that we have a database connection
        if (!defaultDb) {
          throw new Error('Cannot create question: No database connections available. Please create a connection first.');
        }

        const content: QuestionContent = {
          description: '',
          query: options.query || '',
          vizSettings: { type: 'table' },
          parameters: [],
          database_name: defaultDb
        };

        return {
          content,
          fileName: 'New Question',
          metadata: { availableDatabases: databaseNames }
        };
      }

      case 'dashboard': {
        const content: DocumentContent = {
          description: '',
          assets: [],
          layout: { columns: 12, items: [] }
        };

        return {
          content,
          fileName: 'New Dashboard'
        };
      }

      case 'presentation': {
        const content: DocumentContent = {
          description: '',
          assets: [],
          layout: {
            canvasWidth: 1280,
            canvasHeight: 720,
            slides: [{ rectangles: [], arrows: [] }]
          }
        };

        return {
          content,
          fileName: 'New Presentation'
        };
      }

      case 'connection': {
        const content: ConnectionContent = {
          type: 'bigquery',
          config: {}
        };

        return {
          content,
          fileName: 'new_connection'
        };
      }

      case 'folder': {
        return {
          content: { description: '' },
          fileName: 'New Folder'
        };
      }

      case 'context': {
        // Determine folder path (options.path or user's home folder)
        const folderPath = options.path || resolvePath(user.mode, user.home_folder || '');
        const contextPath = `${folderPath}/context`;

        // Compute fullSchema and fullDocs using existing loader logic
        // Pass empty databases array for new context (version 1 has no whitelist yet)
        const { fullSchema, fullDocs } = await computeSchemaFromDatabases(
          [],  // Empty databases array for new context
          contextPath,
          user
        );

        const now = new Date().toISOString();
        const content: ContextContent = {
          versions: [{
            version: 1,
            databases: [],
            docs: [],
            createdAt: now,
            createdBy: user.userId,
            description: 'Initial version'
          }],
          published: { all: 1 },
          fullSchema,
          fullDocs
        };

        return {
          content,
          fileName: 'Knowledge Base'
        };
      }

      case 'report': {
        const content: ReportContent = {
          description: '',
          schedule: {
            cron: '0 9 * * 1',  // Default: Monday 9am
            timezone: 'America/New_York'
          },
          references: [],
          reportPrompt: '',
          emails: []
        };

        return {
          content,
          fileName: 'New Report'
        };
      }

      case 'alert': {
        const content: AlertContent = {
          description: '',
          schedule: {
            cron: '0 9 * * 1',  // Default: Monday 9am
            timezone: 'America/New_York'
          },
          questionId: 0,
          condition: {
            selector: 'all',
            function: 'count',
            operator: '>',
            threshold: 0
          },
          emails: []
        };

        return {
          content,
          fileName: 'New Alert'
        };
      }

      default:
        throw new Error(`Unsupported template type: ${type}`);
    }
  }

  async batchCreateFiles(inputs: BatchCreateInput[], user: EffectiveUser): Promise<BatchCreateFileResult> {
    const results: Array<{ virtualId: number; file: DbFile }> = [];
    for (const input of inputs) {
      const { virtualId, ...createInput } = input;
      const result = await this.createFile(createInput, user);
      results.push({ virtualId, file: result.data });
    }
    return { data: results };
  }

  async batchSaveFiles(inputs: BatchSaveFileInput[], user: EffectiveUser): Promise<BatchSaveFileResult> {
    const results: DbFile[] = [];
    for (const input of inputs) {
      const result = await this.saveFile(input.id, input.name, input.path, input.content, input.references, user);
      results.push(result.data);
    }
    return { data: results };
  }
}

// Export singleton instance - PREFER using this
export const FilesAPI = new FilesDataLayerServer();

// Deprecated: Export individual functions for backward compatibility
// TODO Phase 3: Remove these and use FilesAPI namespace everywhere
export const loadFile = FilesAPI.loadFile.bind(FilesAPI);
export const loadFiles = FilesAPI.loadFiles.bind(FilesAPI);
export const getFiles = FilesAPI.getFiles.bind(FilesAPI);
export const createFile = FilesAPI.createFile.bind(FilesAPI);
export const saveFile = FilesAPI.saveFile.bind(FilesAPI);
export const loadFileByPath = FilesAPI.loadFileByPath.bind(FilesAPI);
export const getTemplate = FilesAPI.getTemplate.bind(FilesAPI);
export const batchCreateFiles = FilesAPI.batchCreateFiles.bind(FilesAPI);
export const batchSaveFiles = FilesAPI.batchSaveFiles.bind(FilesAPI);
