import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { prepareSheetAdjustment } from '@/lib/sheets-import/service.server';
import type { SheetTransform } from '@/lib/sheets-import/types';

// Post-import adjustment step 1: re-download the live sheet, re-extract raw grids, and preview
// the STORED transforms against fresh data (no LLM). The client then drives the same
// revise/confirm loop as a first import.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { spreadsheet_url, transforms, connection_name } = body as {
      spreadsheet_url?: string; transforms?: SheetTransform[]; connection_name?: string;
    };
    if (!spreadsheet_url) return ApiErrors.badRequest('spreadsheet_url is required');
    if (!Array.isArray(transforms) || transforms.length === 0) return ApiErrors.badRequest('transforms is required');
    if (!connection_name) return ApiErrors.badRequest('connection_name is required');

    const result = await prepareSheetAdjustment({
      spreadsheetUrl: spreadsheet_url, transforms, connectionName: connection_name, user,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('Cannot parse') ||
      error.message.includes('No non-empty sheets')
    )) {
      return ApiErrors.badRequest(error.message);
    }
    return handleApiError(error);
  }
});
