import { NextRequest, NextResponse } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFile, saveFile, ConflictError } from '@/lib/data/files.server';
import { validateFileId } from '@/lib/data/helpers/validation';
import { DocumentDB } from '@/lib/database/documents-db';
import { canDeleteFileType } from '@/lib/auth/access-rules';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';

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
      appEventRegistry.publish(AppEvents.FILE_VIEWED, {
        fileId: id,
        fileType: result.data.type,
        filePath: result.data.path,
        fileName: result.data.name,
        userId: user.userId,
        userEmail: user.email,
        userRole: user.role,
        companyId: user.companyId,
      });
      return successResponse(result.data);
    }

    const loadStart = Date.now();
    const result = await loadFile(id, user, options);
    console.log(`[FILES API] loadFile (with refs) took ${Date.now() - loadStart}ms`);
    console.log(`[FILES API] Total request time: ${Date.now() - startTime}ms`);
    // Track direct read (fire-and-forget)
    appEventRegistry.publish(AppEvents.FILE_VIEWED, {
      fileId: id,
      fileType: result.data.type,
      filePath: result.data.path,
      fileName: result.data.name,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,
      companyId: user.companyId,
    });
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
    const { name, path, content, references, editId, expectedVersion } = body;

    if (!name) {
      return ApiErrors.validationError('name is required');
    }

    if (!path) {
      return ApiErrors.validationError('path is required');
    }

    // Metadata-only update: name/path only, content untouched
    if (content === undefined) {
      const file = await DocumentDB.getById(id, user.companyId);
      if (!file) {
        return ApiErrors.notFound('File');
      }
      const oldPath = file.path;

      if (file.type === 'folder' && oldPath !== path) {
        // Step 1: Fetch all descendants (metadata only, no content)
        const descendants = await DocumentDB.listAll(user.companyId, undefined, [oldPath], -1, false);

        // Step 2: Check move permission on every descendant
        const blocked = descendants.filter(f => !canDeleteFileType(f.type));
        if (blocked.length > 0) {
          return ApiErrors.forbidden(
            `Cannot move folder: contains ${blocked.length} file(s) of protected type(s): ${[...new Set(blocked.map(f => f.type))].join(', ')}`
          );
        }

        // Step 3: Atomic update — only the exact IDs we checked
        const descendantIds = descendants.map(f => f.id);
        await DocumentDB.moveFolderAndChildren(id, descendantIds, oldPath, path, name, user.companyId);
      } else {
        const success = await DocumentDB.updateMetadata(id, name, path, user.companyId);
        if (!success) {
          return ApiErrors.notFound('File');
        }
      }

      return successResponse({ id, name, path, oldPath });
    }

    // Full save: update name, path, and content
    // Phase 6: Client sends pre-extracted references (server is dumb, just saves what it receives)
    try {
      const result = await saveFile(id, name, path, content, references || [], user, editId, expectedVersion);
      return successResponse(result.data);
    } catch (error) {
      if (error instanceof ConflictError) {
        return NextResponse.json(
          { error: { type: 'ConflictError', currentFile: error.currentFile } },
          { status: 409 }
        );
      }
      throw error;
    }
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
    appEventRegistry.publish(AppEvents.FILE_DELETED, {
      fileId: id,
      fileType: file.type,
      filePath: file.path,
      fileName: file.name,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,
      companyId: user.companyId,
    });

    return successResponse({ message: 'File deleted successfully' });
  } catch (error) {
    return handleApiError(error);
  }
});
