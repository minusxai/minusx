import { NextRequest } from 'next/server';
import { FilesAPI } from '@/lib/data/files.server';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { UserFacingError } from '@/lib/errors';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { folderName, parentPath } = body;

    if (!folderName || typeof folderName !== 'string' || !folderName.trim()) {
      return ApiErrors.validationError('Folder name is required');
    }

    if (!parentPath || typeof parentPath !== 'string') {
      return ApiErrors.validationError('Parent path is required');
    }

    const fullPath = `${parentPath}/${folderName}`.replace(/\/+/g, '/');

    const result = await FilesAPI.createFile({
      name: folderName,
      path: fullPath,
      type: 'folder',
      content: { description: '' },
      references: [],
    }, user);

    return successResponse({ id: result.data.id, path: fullPath, name: folderName }, 201);
  } catch (error) {
    if (error instanceof UserFacingError) {
      return ApiErrors.badRequest(error.message);
    }
    return handleApiError(error);
  }
});
