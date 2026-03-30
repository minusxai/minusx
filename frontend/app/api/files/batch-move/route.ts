import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { DocumentDB } from '@/lib/database/documents-db';
import { canDeleteFileType } from '@/lib/auth/access-rules';

/**
 * POST /api/files/batch-move
 * Move multiple files to a new destination folder in a single request.
 *
 * Body: { files: Array<{ id: number; name: string; destFolder: string }> }
 *
 * Response: { data: Array<{ id: number; name: string; path: string; oldPath: string }> }
 */
export const POST = withAuth(async (
  request: NextRequest,
  user
) => {
  try {
    const body = await request.json();
    const { files } = body;

    if (!Array.isArray(files) || files.length === 0) {
      return ApiErrors.validationError('files must be a non-empty array');
    }

    const results: Array<{ id: number; name: string; path: string; oldPath: string }> = [];

    for (const entry of files) {
      const { id, name, destFolder } = entry;

      if (!id || !name || !destFolder) {
        return ApiErrors.validationError('Each file must have id, name, and destFolder');
      }

      const file = await DocumentDB.getById(id, user.companyId);
      if (!file) {
        return ApiErrors.notFound(`File ${id}`);
      }

      if (!canDeleteFileType(file.type)) {
        return ApiErrors.forbidden(`Cannot move file of type: ${file.type}`);
      }

      const oldPath = file.path;
      const newPath = `${destFolder}/${name}`;

      if (file.type === 'folder') {
        const descendants = await DocumentDB.listAll(user.companyId, undefined, [oldPath], -1, false);
        const blocked = descendants.filter(f => !canDeleteFileType(f.type));
        if (blocked.length > 0) {
          return ApiErrors.forbidden(
            `Cannot move folder ${name}: contains protected file type(s): ${[...new Set(blocked.map(f => f.type))].join(', ')}`
          );
        }
        const descendantIds = descendants.map(f => f.id);
        await DocumentDB.moveFolderAndChildren(id, descendantIds, oldPath, newPath, name, user.companyId);
      } else {
        const success = await DocumentDB.updateMetadata(id, name, newPath, user.companyId);
        if (!success) {
          return ApiErrors.notFound(`File ${id}`);
        }
      }

      results.push({ id, name, path: newPath, oldPath });
    }

    return successResponse(results);
  } catch (error) {
    return handleApiError(error);
  }
});
