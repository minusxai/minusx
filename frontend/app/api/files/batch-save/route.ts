/**
 * POST /api/files/batch-save
 *
 * Save multiple files atomically using DocumentDB.updateMultiple
 * Used by PublishFile tool for cascade saves
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { handleApiError, successResponse, ApiErrors } from '@/lib/api/api-responses';
import { DocumentDB } from '@/lib/database/documents-db';
import type { BaseFileContent } from '@/lib/types';

interface BatchSaveRequest {
  files: Array<{
    id: number;
    name: string;
    path: string;
    content: BaseFileContent;
    references: number[];
  }>;
  companyId: number;
}

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body: BatchSaveRequest = await request.json();
    const { files, companyId } = body;

    // Validate request
    if (!files || !Array.isArray(files) || files.length === 0) {
      return ApiErrors.validationError('files array is required and must not be empty');
    }

    if (!companyId || companyId !== user.companyId) {
      return ApiErrors.unauthorized('Invalid company ID');
    }

    // Validate all files have required fields
    for (const file of files) {
      if (!file.id || !file.name || !file.path || !file.content) {
        return ApiErrors.validationError('Each file must have id, name, path, and content');
      }
    }

    // Use DocumentDB.updateMultiple for atomic save
    const savedFileIds = await DocumentDB.updateMultiple(files, companyId);

    return successResponse({
      savedFileIds,
      count: savedFileIds.length
    });
  } catch (error) {
    return handleApiError(error);
  }
});
