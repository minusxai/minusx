import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { importGoogleSheetToS3, processFilesFromS3, deleteConnectionFiles } from '@/lib/csv-processor';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { connection_name, spreadsheet_url, schema_name = 'public', replace_existing = false } = body;

    if (!spreadsheet_url) return ApiErrors.badRequest('spreadsheet_url is required');

    if (replace_existing) {
      await deleteConnectionFiles(user.mode, connection_name);
    }

    const { files, spreadsheetId } = await importGoogleSheetToS3(
      spreadsheet_url,
      connection_name,
      user.mode,
      schema_name,
    );

    const registered = await processFilesFromS3(user.mode, connection_name, files);

    return NextResponse.json({
      success: true,
      message: `Successfully imported ${registered.length} sheet(s) from Google Sheets`,
      config: { files: registered, spreadsheet_url, spreadsheet_id: spreadsheetId },
    });
  } catch (error) {
    if (error instanceof Error) {
      const isTerminated = error.message.includes('terminated');
      const knownError =
        isTerminated ||
        error.message.includes('not publicly accessible') ||
        error.message.includes('not found') ||
        error.message.includes('not configured') ||
        error.message.includes('Cannot parse') ||
        error.message.includes('No non-empty sheets');
      if (knownError) {
        const message = isTerminated
          ? 'Something went wrong processing your spreadsheet — please try again'
          : error.message;
        return NextResponse.json({ success: false, message, config: null }, { status: 400 });
      }
    }
    return handleApiError(error);
  }
});
