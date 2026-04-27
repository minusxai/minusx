import 'server-only';
import { DocumentDB } from '@/lib/database/documents-db';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { DbFile, BaseFileContent, FileType, QuestionContent, DocumentContent, ConnectionContent, ContextContent, ReportContent, AlertContent, TransformationContent } from '@/lib/types';
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
  BatchSaveFileInput,
  BatchSaveFileResult,
  DryRunSaveResult,
  MoveFileInput,
  MoveFileResult,
  DeleteFileResult
} from './types';
import { canAccessFile } from './helpers/permissions';
import { extractReferenceIds, extractAllReferenceIds } from './helpers/references';
import { UserFacingError, AccessPermissionError, FileNotFoundError } from '@/lib/errors';
import { validateFileState } from '@/lib/validation/content-validators';
import { validateFileStateServer } from '@/lib/validation/content-validators.server';
import { PROTECTED_FILE_PATHS } from '@/lib/constants';
import { canAccessFileType, canCreateFileType, validateFileLocation, canDeleteFileType, canCreateFileByRole } from '@/lib/auth/access-rules';
import type { AccessRulesOverride } from '@/lib/branding/whitelabel';
import { getConfigs } from './configs.server';
import { resolvePath, resolveHomeFolderSync, isFileTypeAllowedInPath, resolveHomeFolder } from '@/lib/mode/path-resolver';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getLoader, LoaderOptions } from './loaders';
import { listAllConnections } from './connections.server';
import { computeSchemaFromWhitelist } from './loaders/context-loader-utils';
import { makeDefaultContextContent, resolveVersionWhitelist } from '@/lib/context/context-utils';
import { selectDatabase } from '@/lib/utils/database-selector';
import { getFileAnalyticsSummary, getFilesAnalyticsSummary, getConversationAnalytics } from '@/lib/analytics/file-analytics.server';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { hashContent } from '@/lib/utils/query-hash';

/**
 * Resolves direct child IDs for a folder path.
 * Injected into extractReferenceIds to break the circular import that would
 * arise if references.ts imported FilesAPI directly.
 */
const resolveChildIds = async (folderPath: string): Promise<number[]> => {
  const children = await DocumentDB.listAll(undefined, [folderPath], 1, false);
  return children.map(c => c.id);
};

export class ConflictError extends Error {
  currentFile: DbFile;
  constructor(currentFile: DbFile) {
    super('Conflict: file has been modified by another client');
    this.name = 'ConflictError';
    this.currentFile = currentFile;
  }
}

/**
 * Server-side implementation of files data layer
 * Uses direct database access with permission checks
 *
 * NOTE: Token scope validation is handled at the route level (/t/[token]/page.tsx)
 * and in getEffectiveUserFromToken()
 */
class FilesDataLayerServer implements IFilesDataLayer {
  /**
   * Load access rules overrides from org config (cached per-org by configs layer)
   */
  private async _getOverrides(user: EffectiveUser): Promise<AccessRulesOverride | undefined> {
    try {
      const { config } = await getConfigs(user);
      return config.accessRules;
    } catch {
      return undefined;
    }
  }

  async loadFile(id: number, user: EffectiveUser, options?: LoaderOptions): Promise<LoadFileResult> {
    const dbStart = Date.now();
    const file = await DocumentDB.getById(id);
    console.log(`[FILES DataLayer] DocumentDB.getById took ${Date.now() - dbStart}ms`);

    if (!file) {
      throw new FileNotFoundError(id);
    }

    // Load config-based access rule overrides once per request
    const overrides = await this._getOverrides(user);

    // Check file access (unified: type + mode + path) - Phase 4
    console.log(`[FILES DataLayer] Checking access for user:`, {
      email: user.email,
      role: user.role,
      fileType: file.type,
      fileId: id
    });

    if (!canAccessFile(file, user, overrides)) {
      throw new AccessPermissionError('You do not have permission to access this file');
    }

    const refStart = Date.now();
    const refIds = await extractReferenceIds(file, resolveChildIds);
    const isConversation = file.type === 'conversation';
    const [references, analytics, conversationAnalytics] = await Promise.all([
      refIds.length > 0 ? DocumentDB.getByIds(refIds) : Promise.resolve([]),
      getFileAnalyticsSummary(id).catch(() => null),
      isConversation ? getConversationAnalytics(id).catch(() => null) : Promise.resolve(null),
    ]);
    console.log(`[FILES DataLayer] Loading ${refIds.length} references took ${Date.now() - refStart}ms`);

    // Track read_as_reference for each loaded reference (fire-and-forget)
    for (const ref of references) {
      appEventRegistry.publish(AppEvents.FILE_VIEWED_AS_REFERENCE, {
        fileId: ref.id,
        fileVersion: ref.version,
        fileType: ref.type,
        filePath: ref.path,
        fileName: ref.name,
        userId: user.userId,
        userEmail: user.email,
        userRole: user.role,

        mode: user.mode,
        referencedByFileId: file.id,
        referencedByFileType: file.type,
      });
    }

    // Reference filtering depends on the parent file type:
    //   Folder  → children are filesystem entries; apply full canAccessFile (path rules enforced)
    //   Content → embedded assets (questions in a dashboard, etc.); the parent's permission check
    //             is sufficient — only enforce type access + mode isolation, not path
    const modePrefix = `/${user.mode}`;
    const filteredReferences = references.filter(ref => {
      if (file.type === 'folder') {
        return canAccessFile(ref, user, overrides);
      }
      if (!canAccessFileType(user.role, ref.type, overrides)) return false;
      return ref.path === modePrefix || ref.path.startsWith(modePrefix + '/');
    });

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
      metadata: { references: transformedReferences, analytics, conversationAnalytics: conversationAnalytics ?? undefined }
    };
  }

  async loadFiles(ids: number[], user: EffectiveUser, options?: LoaderOptions): Promise<LoadFilesResult> {
    const files = await DocumentDB.getByIds(ids);
    const overrides = await this._getOverrides(user);

    // Filter by unified permission check (Phase 4)
    const filteredFiles = files.filter(f => canAccessFile(f, user, overrides));

    // Track which reference IDs came from folder parents vs content parents so we can
    // apply the right permission check per ref (see comment below).
    const folderFiles = filteredFiles.filter(f => f.type === 'folder');
    const contentFiles = filteredFiles.filter(f => f.type !== 'folder');
    const [folderRefIdArrays, contentRefIdArrays] = await Promise.all([
      Promise.all(folderFiles.map(f => extractReferenceIds(f, resolveChildIds))),
      Promise.all(contentFiles.map(f => extractReferenceIds(f, resolveChildIds))),
    ]);
    const folderRefIds = new Set(folderRefIdArrays.flat());
    const uniqueRefIds = [...new Set([...folderRefIdArrays.flat(), ...contentRefIdArrays.flat()])];

    const [references, analytics] = await Promise.all([
      uniqueRefIds.length > 0 ? DocumentDB.getByIds(uniqueRefIds) : Promise.resolve([]),
      getFilesAnalyticsSummary(filteredFiles.map(f => f.id)).catch(() => ({})),
    ]);

    // Reference filtering depends on the parent file type:
    //   Folder  → children are filesystem entries; apply full canAccessFile (path rules enforced)
    //   Content → embedded assets (questions in a dashboard, etc.); the parent's permission check
    //             is sufficient — only enforce type access + mode isolation, not path
    const modePrefix = `/${user.mode}`;
    const filteredReferences = references.filter(ref => {
      if (folderRefIds.has(ref.id)) {
        return canAccessFile(ref, user, overrides);
      }
      if (!canAccessFileType(user.role, ref.type, overrides)) return false;
      return ref.path === modePrefix || ref.path.startsWith(modePrefix + '/');
    });

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
      metadata: { references: transformedReferences, analytics }
    };
  }

  async getFiles(options: GetFilesOptions, user: EffectiveUser): Promise<GetFilesResult> {
    const { paths = [], type, depth = 1 } = options;

    // Pass path filters and depth to database for SQL-level filtering
    // Phase 6: Skip content loading for performance - references are cached in DB column
    let files = await DocumentDB.listAll(
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
      references: await extractReferenceIds(file, resolveChildIds),
      created_at: file.created_at,
      updated_at: file.updated_at,
      version: file.version,
      last_edit_id: file.last_edit_id,
      draft: file.draft,
      meta: file.meta,
    })));

    const folderInfos: FileInfo[] = folderFiles.map(file => ({
      id: file.id,
      name: file.name,
      path: file.path,
      type: file.type,
      references: [],
      created_at: file.created_at,
      updated_at: file.updated_at,
      version: file.version,
      last_edit_id: file.last_edit_id,
      draft: file.draft,
      meta: file.meta,
    }));

    return {
      data: fileInfos,
      metadata: { folders: folderInfos }
    };
  }

  async createFile(input: CreateFileInput, user: EffectiveUser): Promise<CreateFileResult> {
    const { name, path, type, content, references = [], options, editId } = input;

    // Idempotency: if this editId was already used, return the existing file
    if (editId) {
      const existing = await DocumentDB.getByEditId(editId);
      if (existing) {
        const existingFile = await DocumentDB.getById(existing.id);
        if (existingFile) {
          return { data: existingFile };
        }
      }
    }
    const overrides = await this._getOverrides(user);

    // Check file type access (read permission)
    if (!canAccessFileType(user.role, type, overrides)) {
      throw new AccessPermissionError(`You do not have permission to create files of type: ${type}`);
    }

    // Check write permission — createTypes gates both create and edit
    if (!canCreateFileByRole(user.role, type, overrides)) {
      throw new AccessPermissionError(`Your role (${user.role}) does not have permission to create ${type} files.`);
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
          const exists = await DocumentDB.getByPath(checkPath);
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
      const existingFile = await DocumentDB.getByPath(finalPath);
      if (existingFile) {
        return { data: existingFile };
      }
    }

    // Validate parent folder exists (single SQL check — no loop, no auto-creation)
    if (!options?.createPath) {
      const parentPath = finalPath.substring(0, finalPath.lastIndexOf('/'));
      if (parentPath) {
        const parent = await DocumentDB.getByPath(parentPath);
        if (!parent || parent.type !== 'folder') {
          throw new UserFacingError(`Cannot create file: parent folder '${parentPath}' does not exist`);
        }
      }
    }

    // Handle createPath option: create parent directories as folder types
    if (options?.createPath) {
      const pathSegments = finalPath.split('/').filter(Boolean);
      let currentPath = '';

      // Create each parent folder if it doesn't exist
      for (let i = 0; i < pathSegments.length - 1; i++) {
        currentPath += '/' + pathSegments[i];
        const folderExists = await DocumentDB.getByPath(currentPath);

        if (!folderExists) {
          await DocumentDB.create(
            pathSegments[i],
            currentPath,
            'folder',
            { name: pathSegments[i] },
            [],  // Phase 6: Folders have no references
            undefined,
            false  // folders are structural — visible immediately
          );
          // Create default context for the new folder
          const contextPath = `${currentPath}/context`;
          const contextExists = await DocumentDB.getByPath(contextPath);
          if (!contextExists) {
            await DocumentDB.create('Knowledge Base', contextPath, 'context',
              makeDefaultContextContent(user.userId), [], undefined, false);
          }
        }
      }
    }

    // No need to compute queryResultId — it's a runtime field on FileState, not persisted
    const contentToCreate = content;

    // Validate content schema before writing to DB
    const createValidationError = validateFileState({ type, content: contentToCreate, name, path: finalPath });
    if (createValidationError) {
      throw new UserFacingError(`Invalid file content: ${createValidationError}`);
    }

    // Guard: references must be real (positive) IDs — virtual files must be saved first
    const negativeCreateRefs = references.filter(id => id < 0);
    if (negativeCreateRefs.length > 0) {
      throw new Error(`Cannot create file: references contain unsaved virtual IDs [${negativeCreateRefs.join(', ')}]`);
    }

    // Content types (question/dashboard/notebook/presentation/report) start as drafts until the
    // user explicitly saves. Structural/config types are immediately visible (draft: false).
    const DRAFT_ON_CREATE_TYPES = new Set(['question', 'dashboard', 'notebook', 'presentation', 'report', 'connection']);
    const startAsDraft = DRAFT_ON_CREATE_TYPES.has(type);

    // Create file in database (returns numeric ID)
    // Phase 6: Pass references from client (server is dumb, no extraction)
    const newFileId = await DocumentDB.create(name, finalPath, type, contentToCreate, references, editId, startAsDraft);

    if (!newFileId) {
      throw new Error('Failed to create file');
    }

    // Fetch the newly created file
    const newFile = await DocumentDB.getById(newFileId);

    if (!newFile) {
      throw new Error('File not found after creation');
    }

    // Track created event (fire-and-forget)
    appEventRegistry.publish(AppEvents.FILE_CREATED, {
      fileId: newFile.id,
      fileVersion: newFile.version,
      fileType: newFile.type,
      filePath: newFile.path,
      fileName: newFile.name,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,

      mode: user.mode,
    });

    // Atomically create default context for every new folder
    if (type === 'folder') {
      const contextPath = `${finalPath}/context`;
      const existingContext = await DocumentDB.getByPath(contextPath);
      if (!existingContext) {
        const contextContent = makeDefaultContextContent(user.userId);
        await DocumentDB.create('Knowledge Base', contextPath, 'context', contextContent, [], undefined, false);
      }
    }

    return {
      data: newFile
    };
  }

  async saveFile(id: number, name: string, path: string, content: BaseFileContent, references: number[], user: EffectiveUser, editId?: string, expectedVersion?: number): Promise<SaveFileResult> {
    // Get existing file
    const existingFile = await DocumentDB.getById(id);

    if (!existingFile) {
      throw new FileNotFoundError(id);
    }

    const overrides = await this._getOverrides(user);

    // Check file access (unified: type + mode + path) - Phase 4
    if (!canAccessFile(existingFile, user, overrides)) {
      throw new AccessPermissionError('You do not have permission to modify this file');
    }

    // Check write permission — createTypes gates both create and edit
    if (!canCreateFileByRole(user.role, existingFile.type, overrides)) {
      throw new AccessPermissionError(`Your role (${user.role}) does not have permission to edit ${existingFile.type} files.`);
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

    // For contexts: strip fullSchema/fullDocs (server-computed) and normalize version format.
    // Older clients may send version.databases (legacy) instead of version.whitelist (new).
    // Normalize on every save so the DB always uses the canonical format.
    if (existingFile.type === 'context') {
      const { fullSchema, parentSchema, fullDocs, ...ctx } = content as ContextContent;
      if (ctx.versions) {
        ctx.versions = ctx.versions.map(v => {
          const { databases: _legacy, ...vClean } = v as any;
          return { ...vClean, whitelist: resolveVersionWhitelist(v) };
        });
      }
      contentToSave = ctx as BaseFileContent;
      console.log(`[FILES DataLayer] Stripped fullSchema/parentSchema/fullDocs and normalized version format for context ${name}`);
    }

    // No need to compute queryResultId — it's a runtime field on FileState, not persisted

    // Validate content schema before writing to DB
    const saveValidationError = await validateFileStateServer({ type: existingFile.type, content: contentToSave, name, path });
    if (saveValidationError) {
      throw new UserFacingError(`Invalid file content: ${saveValidationError}`);
    }

    // Guard: references must be real (positive) IDs — virtual files must be saved first
    const negativeSaveRefs = references.filter(id => id < 0);
    if (negativeSaveRefs.length > 0) {
      throw new Error(`Cannot save file ${id}: references contain unsaved virtual IDs [${negativeSaveRefs.join(', ')}]`);
    }

    // Validate parent folder exists when path is changing (single SQL check — no loop)
    const newParentPath = path.substring(0, path.lastIndexOf('/'));
    const oldParentPath = existingFile.path.substring(0, existingFile.path.lastIndexOf('/'));
    if (newParentPath && newParentPath !== oldParentPath) {
      const parent = await DocumentDB.getByPath(newParentPath);
      if (!parent || parent.type !== 'folder') {
        throw new UserFacingError(`Cannot save file: parent folder '${newParentPath}' does not exist`);
      }
    }

    // Phase 6: Server is dumb - just saves what client sends (no extraction)
    const updateResult = await DocumentDB.update(id, name, path, contentToSave, references, editId ?? hashContent({ id, content: contentToSave }), expectedVersion);

    if ('alreadyApplied' in updateResult && updateResult.alreadyApplied) {
      // Already applied — return the current file as success
      const currentFile = await DocumentDB.getById(id);
      if (!currentFile) {
        throw new Error('File not found after update');
      }
      return { data: currentFile };
    }

    if ('conflict' in updateResult && updateResult.conflict) {
      // Version conflict — throw ConflictError with the current server file
      const currentFile = await DocumentDB.getById(id);
      if (!currentFile) {
        throw new Error('File not found during conflict check');
      }
      throw new ConflictError(currentFile);
    }

    // Track updated event (fire-and-forget)
    appEventRegistry.publish(AppEvents.FILE_UPDATED, {
      fileId: id,
      fileVersion: (existingFile.version ?? 1) + 1,
      fileType: existingFile.type,
      filePath: path,
      fileName: name,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,

      mode: user.mode,
    });

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
    const updatedFile = await DocumentDB.getById(id);

    if (!updatedFile) {
      throw new Error('File not found after update');
    }

    return {
      data: updatedFile
    };
  }

  async loadFileByPath(path: string, user: EffectiveUser, options?: LoaderOptions): Promise<LoadFileResult> {
    const file = await DocumentDB.getByPath(path);

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
        const allDbConnections = connections.map(c => ({ metadata: { name: c.name } }));
        // Use centralized database selection logic (returns empty string if no connections)
        const defaultDb = selectDatabase(allDbConnections, options.databaseName);

        const content: QuestionContent = {
          description: '',
          query: options.query || '',
          vizSettings: { type: 'table' },
          parameters: [],
          connection_name: defaultDb || ''
        };

        return {
          content,
          fileName: '',
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
          fileName: ''
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
          fileName: ''
        };
      }

      case 'connection': {
        const content: ConnectionContent = {
          type: 'bigquery',
          config: {}
        };

        return {
          content,
          fileName: ''
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

        // Compute fullSchema, parentSchema and fullDocs using the new whitelist loader
        // New contexts default to whitelist:'*' (expose all available schemas)
        const { fullSchema, parentSchema, fullDocs } = await computeSchemaFromWhitelist(
          '*',
          contextPath,
          user
        );

        const now = new Date().toISOString();
        const content: ContextContent = {
          versions: [{
            version: 1,
            whitelist: '*',
            docs: [],
            createdAt: now,
            createdBy: user.userId,
            description: 'Initial version'
          }],
          published: { all: 1 },
          fullSchema,
          parentSchema,
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
          recipients: []
        };

        return {
          content,
          fileName: ''
        };
      }

      case 'transformation': {
        const content: TransformationContent = {
          description: '',
          transforms: [],
        };

        return {
          content,
          fileName: ''
        };
      }

      case 'alert': {
        const content: AlertContent = {
          description: '',
          schedule: {
            cron: '0 9 * * 1',  // Default: Monday 9am
            timezone: 'America/New_York'
          },
          tests: [],
          recipients: [],
          status: 'draft',
        };

        return {
          content,
          fileName: ''
        };
      }

      default:
        throw new Error(`Unsupported template type: ${type}`);
    }
  }

  async batchSaveFiles(inputs: BatchSaveFileInput[], user: EffectiveUser, dryRun?: false): Promise<BatchSaveFileResult>;
  async batchSaveFiles(inputs: BatchSaveFileInput[], user: EffectiveUser, dryRun: true): Promise<DryRunSaveResult>;
  async batchSaveFiles(inputs: BatchSaveFileInput[], user: EffectiveUser, dryRun: boolean = false): Promise<BatchSaveFileResult | DryRunSaveResult> {
    if (dryRun) {
      return DocumentDB.batchSave(inputs, true);
    }
    const results: DbFile[] = [];
    for (const input of inputs) {
      const result = await this.saveFile(input.id, input.name, input.path, input.content, input.references, user, input.editId, input.expectedVersion);
      results.push(result.data);
    }
    return { data: results };
  }

  async deleteFile(id: number, user: EffectiveUser): Promise<DeleteFileResult> {
    const file = await DocumentDB.getById(id);
    if (!file) {
      throw new FileNotFoundError(id);
    }

    if (!canDeleteFileType(file.type)) {
      // Context files can be deleted when the folder contains more than one —
      // prevents removing the last context file from a folder.
      if (file.type === 'context') {
        const parentPath = file.path.substring(0, file.path.lastIndexOf('/'));
        const siblings = await DocumentDB.listAll('context', [parentPath], 1, false);
        if (siblings.length <= 1) {
          throw new AccessPermissionError(`Cannot delete the only context file in this folder.`);
        }
        // More than one — fall through and allow deletion
      } else {
        throw new AccessPermissionError(
          `Files of type '${file.type}' cannot be deleted. They are critical system files.`
        );
      }
    }

    if (PROTECTED_FILE_PATHS.includes(file.path as any)) {
      throw new AccessPermissionError(`Cannot delete protected file: ${file.path}`);
    }

    if (!isAdmin(user.role)) {
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
      if (!file.path.startsWith(resolvedHomeFolder)) {
        throw new AccessPermissionError('You can only delete files in your home folder');
      }
    }

    let deletedCount: number;
    if (file.type === 'folder') {
      const descendants = await DocumentDB.listAll(undefined, [file.path], -1, false);
      // A 'context' file is normally undeletable, BUT it can be cascade-deleted when
      // its parent folder is also being deleted (the folder is either the root being
      // deleted, or another folder in the subtree that is also being deleted).
      const undeletable = descendants.filter(f => {
        if (canDeleteFileType(f.type)) return false;
        if (f.type === 'context') {
          const parentPath = f.path.substring(0, f.path.lastIndexOf('/'));
          // Exempt if parent folder is the folder being deleted OR is itself a descendant
          const parentIsBeingDeleted =
            parentPath === file.path ||
            descendants.some(d => d.type === 'folder' && d.path === parentPath);
          if (parentIsBeingDeleted) return false;
        }
        return true;
      });
      if (undeletable.length > 0) {
        throw new AccessPermissionError(
          `Cannot delete folder: contains ${undeletable.length} file(s) of undeletable type(s): ${[...new Set(undeletable.map(f => f.type))].join(', ')}`
        );
      }
      const allIds = [...descendants.map(f => f.id), id];
      deletedCount = await DocumentDB.deleteByIds(allIds);
    } else {
      deletedCount = await DocumentDB.deleteByIds([id]);
      if (deletedCount === 0) {
        throw new FileNotFoundError(id);
      }
    }

    appEventRegistry.publish(AppEvents.FILE_DELETED, {
      fileId: id,
      fileVersion: file.version,
      fileType: file.type,
      filePath: file.path,
      fileName: file.name,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,

      mode: user.mode,
    });

    return { id, deletedCount };
  }

  async moveFile(input: MoveFileInput, user: EffectiveUser): Promise<MoveFileResult> {
    const { id, name, newPath } = input;

    const file = await DocumentDB.getById(id);
    if (!file) {
      throw new FileNotFoundError(id);
    }

    if (!canDeleteFileType(file.type)) {
      throw new AccessPermissionError(`Cannot move file of type: ${file.type}`);
    }

    const oldPath = file.path;

    // Validate destination parent folder exists
    const newParentPath = newPath.substring(0, newPath.lastIndexOf('/'));
    const oldParentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    if (newParentPath && newParentPath !== oldParentPath) {
      const parent = await DocumentDB.getByPath(newParentPath);
      if (!parent || parent.type !== 'folder') {
        throw new UserFacingError(`Parent folder '${newParentPath}' does not exist`);
      }
    }

    if (file.type === 'folder' && oldPath !== newPath) {
      // Fetch all descendants (metadata only)
      const descendants = await DocumentDB.listAll(undefined, [oldPath], -1, false);

      // Check move permission on every descendant
      const blocked = descendants.filter(f => !canDeleteFileType(f.type));
      if (blocked.length > 0) {
        throw new AccessPermissionError(
          `Cannot move folder: contains ${blocked.length} file(s) of protected type(s): ${[...new Set(blocked.map(f => f.type))].join(', ')}`
        );
      }

      const descendantIds = descendants.map(f => f.id);
      await DocumentDB.moveFolderAndChildren(id, descendantIds, oldPath, newPath, name);
    } else {
      const success = await DocumentDB.updateMetadata(id, name, newPath);
      if (!success) {
        throw new FileNotFoundError(id);
      }
    }

    return { id, name, path: newPath, oldPath };
  }

  async batchMoveFiles(inputs: MoveFileInput[], user: EffectiveUser): Promise<MoveFileResult[]> {
    const results: MoveFileResult[] = [];
    for (const input of inputs) {
      results.push(await this.moveFile(input, user));
    }
    return results;
  }

  async appendJsonArray(
    id: number,
    entries: any[],
    expectedLength: number | undefined,
    _user: EffectiveUser,
    arrayPath?: string,
    metaPath?: string | null
  ): Promise<boolean> {
    return DocumentDB.appendJsonArray(id, entries, expectedLength, arrayPath, metaPath);
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
export const batchSaveFiles = FilesAPI.batchSaveFiles.bind(FilesAPI);
export const moveFile = FilesAPI.moveFile.bind(FilesAPI);
export const batchMoveFiles = FilesAPI.batchMoveFiles.bind(FilesAPI);
export const deleteFile = FilesAPI.deleteFile.bind(FilesAPI);
