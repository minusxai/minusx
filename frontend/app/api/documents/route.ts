import { NextRequest } from 'next/server';
import { DocumentDB } from '@/lib/database/documents-db';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { createFile } from '@/lib/data/files.server';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';

// Database initialization is now handled automatically by the adapter

/**
 * GET /api/documents
 * List all documents, optionally filtered by type
 * Non-admins only see files in their home folder and subfolders
 */
export const GET = withAuth(async (request: NextRequest, user) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');

    // Use optimized path filtering for non-admin users
    const pathFilter = !isAdmin(user.role)
      ? [resolveHomeFolderSync(user.mode, user.home_folder)]
      : undefined;

    const documents = await DocumentDB.listAll(
      user.companyId,
      type || undefined,
      pathFilter,
      -1 // All descendants
    );

    return successResponse({ documents });
  } catch (error) {
    return handleApiError(error);
  }
});

/**
 * POST /api/documents
 * Create a new document
 * Non-admins can only create files in their home folder
 */
export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { name, path, type, content, references } = body;

    if (!name || !path || !type || !content) {
      return ApiErrors.validationError('Missing required fields: name, path, type, content');
    }

    // Phase 6: Client sends pre-extracted references (server is dumb, just saves what it receives)
    const result = await createFile({ name, path, type, content, references: references || [] }, user);

    return successResponse(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
});
