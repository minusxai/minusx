import 'server-only';
import { DocumentDB } from '@/lib/database/documents-db';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { DbFile, BaseFileContent, FileType, QuestionContent, ConnectionContent, ContextContent, ReportContent, AlertContent, CsvFileInfo } from '@/lib/types';
import { pruneConnectionSchemaToFiles } from '@/lib/data/helpers/prune-connection-schema';
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
import { extractReferenceIds } from './helpers/references';
import { UserFacingError, AccessPermissionError, FileNotFoundError } from '@/lib/errors';
import { validateFileState } from '@/lib/validation/content-validators';
import { getTemplateDefaults } from '@/lib/data/story/template-defaults';
import { withCompiledStoryCss } from '@/lib/data/story/story-css.server';
import { validateFileStateServer } from '@/lib/validation/content-validators.server';
import { stampAndValidateViews, ViewSaveError } from '@/lib/views/save-gate.server';
import { PROTECTED_FILE_PATHS } from '@/lib/constants';
import { canAccessFileType, canCreateFileType, validateFileLocation, canDeleteFileType, canCreateFileByRole } from '@/lib/auth/access-rules';
import type { AccessRulesOverride } from '@/lib/branding/whitelabel';
import { getConfigs } from './configs.server';
import { resolvePath, resolveHomeFolderSync, isFileTypeAllowedInPath, resolveHomeFolder } from '@/lib/mode/path-resolver';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getLoader, LoaderOptions } from './loaders';
import { listAllConnections } from './connections.server';
import { extractConnectionSecrets, mergeExistingSecretRefs } from '@/lib/secrets/connection-secrets.server';
import { extractConfigSecrets, modeFromPhysicalPath } from '@/lib/secrets/config-secrets.server';
import { restoreRedactedConfigSecrets } from '@/lib/secrets/config-secret-specs';
import { computeSchemaFromWhitelist } from './loaders/context-loader-utils';
import { makeDefaultContextContent, resolveVersionWhitelist } from '@/lib/context/context-utils';
import { selectDatabase } from '@/lib/utils/database-selector';
import { getFileAnalyticsSummary, getFilesAnalyticsSummary, getConversationAnalytics } from '@/lib/analytics/file-analytics.server';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { hashContent } from '@/lib/utils/query-hash';
import { SharesAPI } from '@/lib/data/shares/shares.server';

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

    if (!file) {
      throw new FileNotFoundError(id);
    }

    // Load config-based access rule overrides once per request
    const overrides = await this._getOverrides(user);

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

    // N+1 fix (Sentry MINUSX-BI-9): folder files have their children resolved
    // by `resolveChildIds(path)`, which does one `path LIKE …` query per
    // folder. With N folders that was N round-trips (Sentry observed 19 in a
    // single /api/files call). Pre-fetch all folder children in one query
    // (DocumentDB.listAll accepts multiple paths and OR's them together),
    // then expose a cache-backed resolver so `extractReferenceIds` for
    // folders becomes a map lookup.
    const folderPaths = files.filter(f => f.type === 'folder').map(f => f.path);
    const childIdsByParent = new Map<string, number[]>();
    if (folderPaths.length > 0) {
      const allChildren = await DocumentDB.listAll(undefined, folderPaths, 1, false);
      for (const child of allChildren) {
        // A file's parent path is everything up to the last "/" — match against
        // the requested folder paths (listAll OR's path-LIKE, so any child can
        // belong to any of the requested parents).
        const lastSlash = child.path.lastIndexOf('/');
        const parent = lastSlash > 0 ? child.path.substring(0, lastSlash) : '/';
        const arr = childIdsByParent.get(parent);
        if (arr) arr.push(child.id);
        else childIdsByParent.set(parent, [child.id]);
      }
    }
    const resolveChildIdsCached = async (folderPath: string): Promise<number[]> => {
      const cached = childIdsByParent.get(folderPath);
      if (cached !== undefined) return cached;
      // Fallback for any folder not in our pre-fetched set (defensive — should
      // not happen given we pre-filtered all folder files above).
      return resolveChildIds(folderPath);
    };

    const fileInfos: FileInfo[] = await Promise.all(files.map(async file => ({
      id: file.id,
      name: file.name,
      path: file.path,
      type: file.type,
      references: await extractReferenceIds(file, resolveChildIdsCached),
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
    // Guard the single write path: references must be an array (a non-array
    // JSONB value can never reach the DB through FilesAPI).
    const safeReferences = Array.isArray(references) ? references : [];

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
    let contentToCreate = content;
    // File Architecture v2: a new connection's raw credentials go to the server-only secrets
    // store; the document persists @SECRETS/… refs.
    if (type === 'connection' && (content as ConnectionContent | null)?.config) {
      const cc = content as ConnectionContent;
      contentToCreate = { ...cc, config: await extractConnectionSecrets(name, cc.config) } as BaseFileContent;
    }

    // For stories: compiledCss is server-managed — computed from the markup here (and on every
    // save), never trusted from the client, so the stylesheet can't drift from the story body.
    if (type === 'story') {
      contentToCreate = await withCompiledStoryCss(contentToCreate as { story?: string | null }) as BaseFileContent;
    }

    // Validate content schema before writing to DB
    const createValidationError = validateFileState({ type, content: contentToCreate, name, path: finalPath });
    if (createValidationError) {
      throw new UserFacingError(`Invalid file content: ${createValidationError}`);
    }

    // Guard: references must be real (positive) IDs — virtual files must be saved first
    const negativeCreateRefs = safeReferences.filter(id => id < 0);
    if (negativeCreateRefs.length > 0) {
      throw new Error(`Cannot create file: references contain unsaved virtual IDs [${negativeCreateRefs.join(', ')}]`);
    }

    // Structural/system types are immediately visible on create. Everything else (user-created
    // content) starts as draft until the user explicitly saves.
    const LIVE_ON_CREATE_TYPES = new Set(['folder', 'config', 'styles', 'context', 'context_run', 'alert_run', 'report_run', 'session']);
    const startAsDraft = !LIVE_ON_CREATE_TYPES.has(type);

    // Create file in database (returns numeric ID)
    // Phase 6: Pass references from client (server is dumb, no extraction)
    const newFileId = await DocumentDB.create(name, finalPath, type, contentToCreate, safeReferences, editId, startAsDraft, input.meta ?? null);

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
    // Guard the single write path: references must be an array (a non-array
    // JSONB value can never reach the DB through FilesAPI).
    references = Array.isArray(references) ? references : [];
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

    // For connections: the schema is server-managed — ignore the client copy but
    // keep the previously cached schema, so post-save loads can serve it
    // stale-while-revalidating instead of blocking on a full re-introspection.
    if (existingFile.type === 'connection') {
      const { schema, ...connectionContentWithoutSchema } = content as ConnectionContent;
      const previousSchema = (existingFile.content as ConnectionContent | null)?.schema;
      // File Architecture v2: move raw credentials out of the document into the server-only
      // secrets store; the persisted config holds @SECRETS/… refs instead.
      if (connectionContentWithoutSchema.config) {
        // getSafeConfig strips secrets on load, so an UNCHANGED credential comes back absent
        // (or ""). Carry the existing @SECRETS ref forward so an edit to a non-secret field
        // doesn't wipe the password; a newly-entered raw value is extracted as normal.
        const existingConfig = ((existingFile.content as ConnectionContent | null)?.config ?? {}) as Record<string, unknown>;
        const merged = mergeExistingSecretRefs(connectionContentWithoutSchema.config, existingConfig);
        connectionContentWithoutSchema.config = await extractConnectionSecrets(name, merged);
      }
      // STATIC connections (CSV / Sheets) derive their schema from config.files. Reconcile the kept
      // cache against the just-saved files so a deleted/renamed table doesn't linger in the Table View
      // or the agent's schema until the slow background re-introspection lands. No-op for live DBs.
      const newFiles = (connectionContentWithoutSchema.config as { files?: CsvFileInfo[] } | undefined)?.files;
      const reconciledSchema = pruneConnectionSchemaToFiles(previousSchema, newFiles);
      contentToSave = (reconciledSchema
        ? { ...connectionContentWithoutSchema, schema: reconciledSchema }
        : connectionContentWithoutSchema) as BaseFileContent;
    }

    // For contexts: strip fullSchema/fullDocs (server-computed) and normalize version format.
    // Older clients may send version.databases (legacy) instead of version.whitelist (new).
    // Normalize on every save so the DB always uses the canonical format.
    if (existingFile.type === 'context') {
      const { fullSchema, parentSchema, fullDocs, fullSkills, ...ctx } = content as ContextContent;
      if (ctx.versions) {
        ctx.versions = ctx.versions.map(v => {
          const { databases: _legacy, ...vClean } = v as any;
          return { ...vClean, whitelist: resolveVersionWhitelist(v) };
        });
      }
      contentToSave = ctx as BaseFileContent;
    }

    // No need to compute queryResultId — it's a runtime field on FileState, not persisted

    // For configs: credentials are server-managed via the secrets store. Restore any
    // round-tripped redacted placeholders from the stored doc, then extract raw values
    // to @SECRETS/… refs — the persisted document never contains a raw credential.
    if (existingFile.type === 'config') {
      const restored = restoreRedactedConfigSecrets(contentToSave, existingFile.content ?? {});
      contentToSave = await extractConfigSecrets(modeFromPhysicalPath(existingFile.path), restored) as BaseFileContent;
    }

    // For stories: compiledCss is server-managed — recomputed from the (possibly edited) markup
    // on EVERY write path (agent EditFile, WYSIWYG browser save, raw API), so the stylesheet can
    // never drift from the story body; any client-sent copy is discarded.
    if (existingFile.type === 'story') {
      contentToSave = await withCompiledStoryCss(contentToSave as { story?: string | null }) as BaseFileContent;
    }

    // Validate content schema before writing to DB
    const saveValidationError = await validateFileStateServer({ type: existingFile.type, content: contentToSave, name, path });
    if (saveValidationError) {
      throw new UserFacingError(`Invalid file content: ${saveValidationError}`);
    }

    // The view gate. Every context write lands here — the view dialog, the raw
    // JSON editor, and the agent's EditFile alike — so this is the ONLY place
    // that can honestly enforce what a view may read. It recomputes each view's
    // `reads` from its SQL (never trusting the client) and refuses a view that
    // reaches outside what the parent knowledge base offers, or that reads a view
    // which no longer exists (i.e. deleting a view its dependents still need).
    if (existingFile.type === 'context') {
      try {
        contentToSave = await stampAndValidateViews(contentToSave as ContextContent, path, user) as BaseFileContent;
      } catch (err) {
        if (err instanceof ViewSaveError) throw new UserFacingError(err.message);
        throw err;
      }
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
    const updateResult = await DocumentDB.update(id, name, path, contentToSave, references, editId ?? hashContent({ id, name, path, content: contentToSave }), expectedVersion);

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

    // For connections, return immediately with the previous schema; the config
    // change may have altered tables, so re-introspect in the background
    if (existingFile.type === 'connection') {
      return this.loadFile(id, user, { backgroundRefresh: true });
    }

    // For contexts, reload through loader to recompute fullSchema and fullDocs
    if (existingFile.type === 'context') {
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
          ...(getTemplateDefaults('question', { query: options.query }) as QuestionContent),
          connection_name: defaultDb || '',  // dynamic: suggested from connections
        };

        return {
          content,
          fileName: '',
          metadata: { availableDatabases: databaseNames }
        };
      }

      case 'dashboard':
        return { content: getTemplateDefaults('dashboard')!, fileName: '' };

      case 'story':
        return { content: getTemplateDefaults('story')!, fileName: '' };

      case 'notebook':
        return { content: getTemplateDefaults('notebook')!, fileName: '' };

      case 'connection':
        return { content: getTemplateDefaults('connection')!, fileName: '' };

      case 'folder':
        return { content: getTemplateDefaults('folder')!, fileName: 'New Folder' };

      case 'context': {
        // Determine folder path (options.path or user's home folder)
        const folderPath = options.path || resolvePath(user.mode, user.home_folder || '');
        const contextPath = `${folderPath}/context`;

        // Compute fullSchema, parentSchema and fullDocs using the new whitelist loader
        // New contexts default to whitelist:'*' (expose all available schemas)
        const { fullSchema, parentSchema, fullDocs, fullSkills } = await computeSchemaFromWhitelist(
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
          fullDocs,
          fullSkills
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
          reportPrompt: '',
          recipients: []
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
    const conflicts: Array<{ id: number; currentFile: DbFile }> = [];
    for (const input of inputs) {
      try {
        const result = await this.saveFile(input.id, input.name, input.path, input.content, input.references, user, input.editId, input.expectedVersion);
        results.push(result.data);
      } catch (err) {
        // Best-effort batch: conflicts don't abort the loop. The client will
        // resolve each conflicted file individually via publishFile (which
        // merges local edits onto the server's latest file and retries).
        // Any other error (auth, validation, etc.) still propagates.
        if (err instanceof ConflictError) {
          conflicts.push({ id: input.id, currentFile: err.currentFile });
          continue;
        }
        throw err;
      }
    }
    return conflicts.length > 0
      ? { data: results, conflicts }
      : { data: results };
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

// Deprecated: shares moved to lib/data/shares/ (SharesAPI). These wrappers preserve the old
// call signatures for existing callers (see lib/data/shares/shares.server.ts for the real logic).
export const resolveShare = SharesAPI.resolveShare.bind(SharesAPI);
export const setStoryPreview = SharesAPI.setStoryPreview.bind(SharesAPI);
export const getShares = (fileId: number, user: EffectiveUser) => SharesAPI.listShares(fileId, user);
export const addShare = (fileId: number, user: EffectiveUser, label?: string) => SharesAPI.createShare(fileId, user, label);
export const revokeShare = (fileId: number, user: EffectiveUser, nonce: string) => SharesAPI.revokeShare(fileId, nonce, user);
