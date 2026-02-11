import { NextRequest } from 'next/server';
import { DocumentDB } from '@/lib/database/documents-db';
import { FolderContent } from '@/lib/types';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { folderName, parentPath } = body;

    // Validate inputs
    if (!folderName || typeof folderName !== 'string' || !folderName.trim()) {
      return ApiErrors.validationError('Folder name is required');
    }

    if (!parentPath || typeof parentPath !== 'string') {
      return ApiErrors.validationError('Parent path is required');
    }

    // Construct full path (keep folder name as-is, no slugification)
    const fullPath = `${parentPath}/${folderName}`.replace(/\/+/g, '/'); // normalize multiple slashes

    // Check if folder already exists at this path
    const existing = await DocumentDB.getByPath(fullPath, user.companyId);
    if (existing) {
      return ApiErrors.conflict('A folder or file already exists at this path');
    }

    // Create folder entry (name is in file metadata, not content)
    const content: FolderContent = {
      description: ''
    };

    const id = await DocumentDB.create(folderName, fullPath, 'folder', content, [], user.companyId);  // Phase 6: Folders have no references

    return successResponse({
      id,
      path: fullPath,
      name: folderName
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
});
