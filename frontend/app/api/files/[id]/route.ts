import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFile, saveFile } from '@/lib/data/files.server';
import { validateFileId } from '@/lib/data/helpers/validation';

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
      return successResponse(result.data);
    }

    const loadStart = Date.now();
    const result = await loadFile(id, user, options);
    console.log(`[FILES API] loadFile (with refs) took ${Date.now() - loadStart}ms`);
    console.log(`[FILES API] Total request time: ${Date.now() - startTime}ms`);
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
