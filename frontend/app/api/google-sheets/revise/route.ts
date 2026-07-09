import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { reviseSheetTransforms } from '@/lib/sheets-import/service.server';
import type { RawGridFile, SheetTransform } from '@/lib/sheets-import/types';

// Agentic Sheets import step 2 (optional, repeatable): the user gives feedback on the proposed
// tables; the agent revises the transforms over the SAME raw grids and returns fresh previews.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { raw_files, transforms, feedback, connection_name } = body as {
      raw_files?: RawGridFile[]; transforms?: SheetTransform[]; feedback?: string; connection_name?: string;
    };
    if (!Array.isArray(raw_files) || raw_files.length === 0) return ApiErrors.badRequest('raw_files is required');
    if (!Array.isArray(transforms)) return ApiErrors.badRequest('transforms is required');
    if (!feedback?.trim()) return ApiErrors.badRequest('feedback is required');
    if (!connection_name) return ApiErrors.badRequest('connection_name is required');

    const result = await reviseSheetTransforms({
      rawFiles: raw_files, transforms, feedback, connectionName: connection_name, user,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('outside the connection prefix') ||
      error.message.includes('Could not author')
    )) {
      return ApiErrors.badRequest(error.message);
    }
    return handleApiError(error);
  }
});
