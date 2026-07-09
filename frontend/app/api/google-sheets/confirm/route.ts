import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { confirmSheetImport } from '@/lib/sheets-import/service.server';
import type { RawGridFile, SheetTransform } from '@/lib/sheets-import/types';

// Agentic Sheets import step 3: materialize the ACCEPTED transforms to Parquet and return
// connection-ready file records (transform attached for resync). The client persists them onto
// the static connection exactly like the plain import flow persists its `config.files`.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { spreadsheet_url, raw_files, transforms, connection_name } = body as {
      spreadsheet_url?: string; raw_files?: RawGridFile[]; transforms?: SheetTransform[]; connection_name?: string;
    };
    if (!spreadsheet_url) return ApiErrors.badRequest('spreadsheet_url is required');
    if (!Array.isArray(raw_files) || raw_files.length === 0) return ApiErrors.badRequest('raw_files is required');
    if (!Array.isArray(transforms) || transforms.length === 0) return ApiErrors.badRequest('transforms is required');
    if (!connection_name) return ApiErrors.badRequest('connection_name is required');

    const files = await confirmSheetImport({
      spreadsheetUrl: spreadsheet_url, rawFiles: raw_files, transforms, connectionName: connection_name, user,
    });
    return successResponse({ files, spreadsheet_url, spreadsheet_id: files[0]?.spreadsheet_id });
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('outside the connection prefix') ||
      error.message.includes('Cannot parse') ||
      error.message.includes('No transforms')
    )) {
      return ApiErrors.badRequest(error.message);
    }
    return handleApiError(error);
  }
});
