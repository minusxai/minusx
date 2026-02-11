import { NextRequest } from 'next/server';
import { DocumentDB } from '@/lib/database/documents-db';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { canDeleteFileType } from '@/lib/auth/access-rules';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';

export const GET = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      return ApiErrors.badRequest('Invalid document ID');
    }
    const file = await DocumentDB.getById(id, user.companyId);

    if (!file) {
      return ApiErrors.notFound('Document');
    }

    // Check if non-admin is trying to access file outside their home folder
    if (!isAdmin(user.role)) {
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
      if (!file.path.startsWith(resolvedHomeFolder)) {
        return ApiErrors.forbidden('You can only access files in your home folder');
      }
    }

    return successResponse(file);
  } catch (error) {
    return handleApiError(error);
  }
});

// PUT handler removed - unused legacy endpoint with backward compat mess
// Use PATCH /api/files/[id] instead for content updates (client sends references)

export const PATCH = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      return ApiErrors.badRequest('Invalid document ID');
    }

    // Check access before allowing update
    const file = await DocumentDB.getById(id, user.companyId);
    if (!file) {
      return ApiErrors.notFound('Document');
    }

    // Check if non-admin is trying to update file outside their home folder
    if (!isAdmin(user.role)) {
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
      if (!file.path.startsWith(resolvedHomeFolder)) {
        return ApiErrors.forbidden('You can only update files in your home folder');
      }
    }

    const body = await request.json();
    const { newPath } = body;

    if (!newPath) {
      return ApiErrors.validationError('newPath is required');
    }

    // Check if non-admin is trying to move file to path outside their home folder
    if (!isAdmin(user.role)) {
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
      if (!newPath.startsWith(resolvedHomeFolder)) {
        return ApiErrors.forbidden('You can only move files within your home folder');
      }
    }

    const success = await DocumentDB.updatePath(id, newPath, user.companyId);

    if (!success) {
      return ApiErrors.notFound('Document');
    }

    return successResponse({ message: 'Document path updated successfully' });
  } catch (error) {
    return handleApiError(error);
  }
});

export const DELETE = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      return ApiErrors.badRequest('Invalid document ID');
    }

    // Check access before allowing delete
    const file = await DocumentDB.getById(id, user.companyId);
    if (!file) {
      return ApiErrors.notFound('Document');
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

    // If it's a folder, recursively delete all contents
    if (file.type === 'folder') {
      // Use optimized path filtering with depth=-1 for all descendants
      const filesToDelete = await DocumentDB.listAll(user.companyId, undefined, [file.path], -1);

      console.log(`[DELETE] Deleting folder "${file.name}" and ${filesToDelete.length} items inside it`);

      // Delete all files and subfolders
      for (const fileToDelete of filesToDelete) {
        await DocumentDB.delete(fileToDelete.id, user.companyId);
      }
    }

    // Delete the folder/file itself
    const success = await DocumentDB.delete(id, user.companyId);

    if (!success) {
      return ApiErrors.notFound('Document');
    }

    return successResponse({ message: 'Document deleted successfully' });
  } catch (error) {
    return handleApiError(error);
  }
});
