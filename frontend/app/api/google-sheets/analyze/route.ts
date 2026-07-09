import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { analyzeSpreadsheet } from '@/lib/sheets-import/service.server';

// Agentic Sheets import step 1: download the spreadsheet, extract raw positional grids, and
// have the agent author validated transforms (with executed previews). Nothing is registered
// on the connection yet — the client shows the previews for confirm/redact/feedback.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // grid extraction + agent loop + preview execution

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { spreadsheet_url, connection_name } = body as { spreadsheet_url?: string; connection_name?: string };
    if (!spreadsheet_url) return ApiErrors.badRequest('spreadsheet_url is required');
    if (!connection_name) return ApiErrors.badRequest('connection_name is required');

    const result = await analyzeSpreadsheet({ spreadsheetUrl: spreadsheet_url, connectionName: connection_name, user });
    return successResponse(result);
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('not publicly accessible') ||
      error.message.includes('not found') ||
      error.message.includes('Cannot parse') ||
      error.message.includes('No non-empty sheets') ||
      error.message.includes('Could not author')
    )) {
      return ApiErrors.badRequest(error.message);
    }
    return handleApiError(error);
  }
});
