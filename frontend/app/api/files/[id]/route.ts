import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFile, saveFile } from '@/lib/data/files.server';
import { validateFileId } from '@/lib/data/helpers/validation';
import { DocumentDB } from '@/lib/database/documents-db';
import { canDeleteFileType } from '@/lib/auth/access-rules';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { trackFileEvent } from '@/lib/analytics/file-analytics.server';

// Route segment config: optimize for API routes
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/files/[id]?include=references
 * Load a single file, optionally with all its references
 */
export const GET = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  const startTime = Date.now();
  console.log('[FILES API] Start GET /api/files/[id]');
  try {
    const { id: idStr } = await params;
    const id = validateFileId(idStr);

    const includeReferences = request.nextUrl.searchParams.get('include') === 'references';
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true';
    console.log(`[FILES API] Loading file ${id}, includeReferences=${includeReferences}, refresh=${forceRefresh}`);

    const options = forceRefresh ? { refresh: true } : undefined;

    if (!includeReferences) {
      const loadStart = Date.now();
      const result = await loadFile(id, user, options);
      console.log(`[FILES API] loadFile took ${Date.now() - loadStart}ms`);
      console.log(`[FILES API] Total request time: ${Date.now() - startTime}ms`);
      // Track direct read (fire-and-forget)
      trackFileEvent({
        eventType: 'read_direct',
        fileId: id,
        fileType: result.data.type,
        filePath: result.data.path,
        fileName: result.data.name,
        userId: user.userId,
        userEmail: user.email,
        userRole: user.role,
        companyId: user.companyId,
      }).catch(err => console.error('[analytics] trackFileEvent failed:', err));
      return successResponse(result.data);
    }

    const loadStart = Date.now();
    const result = await loadFile(id, user, options);
    console.log(`[FILES API] loadFile (with refs) took ${Date.now() - loadStart}ms`);
    console.log(`[FILES API] Total request time: ${Date.now() - startTime}ms`);
    // Track direct read (fire-and-forget)
    trackFileEvent({
      eventType: 'read_direct',
      fileId: id,
      fileType: result.data.type,
      filePath: result.data.path,
      fileName: result.data.name,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,
      companyId: user.companyId,
    }).catch(err => console.error('[analytics] trackFileEvent failed:', err));
    return successResponse(result);
  } catch (error) {
    console.log(`[FILES API] Error after ${Date.now() - startTime}ms`);
    return handleApiError(error);
  }
});

/**
 * PATCH /api/files/[id]
 * Save file content (Phase 2)
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id: idStr } = await params;
    const id = validateFileId(idStr);

    const body = await request.json();
    const { name, path, content, references } = body;

    if (!name) {
      return ApiErrors.validationError('name is required');
    }

    if (!path) {
      return ApiErrors.validationError('path is required');
    }

    if (!content) {
      return ApiErrors.validationError('content is required');
    }

    // Phase 6: Client sends pre-extracted references (server is dumb, just saves what it receives)
    const result = await saveFile(id, name, path, content, references || [], user);

    return successResponse(result.data);
  } catch (error) {
    return handleApiError(error);
  }
});

/**
 * DELETE /api/files/[id]
 * Delete a file (and recursively delete folder contents)
 */
export const DELETE = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id: idStr } = await params;
    const id = validateFileId(idStr);

    // Check access before allowing delete
    const file = await DocumentDB.getById(id, user.companyId);
    if (!file) {
      return ApiErrors.notFound('File');
    }

    // Check if file type can be deleted (blocks config/styles universally)
    if (!canDeleteFileType(file.type)) {
      return ApiErrors.forbidden(
        `Files of type '${file.type}' cannot be deleted. They are critical system files.`
      );
    }

    // Check if non-admin is trying to delete file outside their home folder
    if (!isAdmin(user.role)) {
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
      if (!file.path.startsWith(resolvedHomeFolder)) {
        return ApiErrors.forbidden('You can only delete files in your home folder');
      }
    }

    // If it's a folder, check all descendants are deletable before removing anything
    if (file.type === 'folder') {
      const descendants = await DocumentDB.listAll(user.companyId, undefined, [file.path], -1, false);
      const undeletable = descendants.filter(f => !canDeleteFileType(f.type));
      if (undeletable.length > 0) {
        return ApiErrors.forbidden(
          `Cannot delete folder: contains ${undeletable.length} file(s) of undeletable type(s): ${[...new Set(undeletable.map(f => f.type))].join(', ')}`
        );
      }
      const allIds = [...descendants.map(f => f.id), id];
      await DocumentDB.deleteByIds(allIds, user.companyId);
      console.log(`[DELETE] Deleted folder "${file.name}" and ${descendants.length} items inside it`);
    } else {
      // Delete the non-folder file itself
      const deletedCount = await DocumentDB.deleteByIds([id], user.companyId);
      if (deletedCount === 0) {
        return ApiErrors.notFound('File');
      }
    }

    // Track deleted event (fire-and-forget)
    trackFileEvent({
      eventType: 'deleted',
      fileId: id,
      fileType: file.type,
      filePath: file.path,
      fileName: file.name,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,
      companyId: user.companyId,
    }).catch(err => console.error('[analytics] trackFileEvent failed:', err));

    return successResponse({ message: 'File deleted successfully' });
  } catch (error) {
    return handleApiError(error);
  }
});
