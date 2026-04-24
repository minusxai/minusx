import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFile, saveFile, moveFile, deleteFile, ConflictError } from '@/lib/data/files.server';
import { validateFileId } from '@/lib/data/helpers/validation';
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
        fileVersion: result.data.version,
        fileType: result.data.type,
        filePath: result.data.path,
        fileName: result.data.name,
        userId: user.userId,
        userEmail: user.email,
        userRole: user.role,

        mode: user.mode,
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
      fileVersion: result.data.version,
      fileType: result.data.type,
      filePath: result.data.path,
      fileName: result.data.name,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,

      mode: user.mode,
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
      const result = await moveFile({ id, name, newPath: path }, user);
      return successResponse(result);
    }

    // Full save: update name, path, and content
    // Phase 6: Client sends pre-extracted references (server is dumb, just saves what it receives)
    try {
      const result = await saveFile(id, name, path, content, references || [], user, editId, expectedVersion);
      if (result.data.type === 'config') {
        revalidateTag('configs', 'default');
      }
      // Context files need fullSchema recomputed after save (saveFile strips it).
      // Re-run the loader so the client gets fresh fullSchema immediately.
      if (result.data.type === 'context') {
        const loaded = await loadFile(id, user, { refresh: true });
        return successResponse(loaded.data);
      }
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

    const result = await deleteFile(id, user);
    return successResponse({ message: 'File deleted successfully', ...result });
  } catch (error) {
    return handleApiError(error);
  }
});
