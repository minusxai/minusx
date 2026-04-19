import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { deleteS3File, importGoogleSheetToS3, processFilesFromS3 } from '@/lib/csv-processor';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { spreadsheet_id, spreadsheet_url, schema_name = 'public', old_s3_keys = [] } = body;

    if (!spreadsheet_url) return ApiErrors.badRequest('spreadsheet_url is required');
    if (!spreadsheet_id) return ApiErrors.badRequest('spreadsheet_id is required');

    // Re-download and upload the spreadsheet sheets to S3 FIRST —
    // only delete old files once we have confirmed new data, so a failed fetch
    // never leaves the connection with zero tables.
    const { files: incomingFiles, spreadsheetId } = await importGoogleSheetToS3(
      spreadsheet_url,
      'static',
      user.companyId,
      user.mode,
      schema_name,
    );

    // Read column/row metadata from S3 via DuckDB (validates new files are readable)
    const registered = await processFilesFromS3(user.companyId, user.mode, 'static', incomingFiles);

    // New data confirmed — now delete the old S3 files (best-effort, non-fatal)
    await Promise.allSettled(
      (old_s3_keys as string[])
        .filter((key) => key.startsWith(`${user.companyId}/`)) // security check
        .map((key) => deleteS3File(key)),
    );

    // Attach source metadata to every file so the UI can group/refresh them
    const files = registered.map((f) => ({
      ...f,
      source_type: 'google_sheets' as const,
      spreadsheet_url,
      spreadsheet_id: spreadsheetId,
    }));

    return NextResponse.json({
      success: true,
      message: `Re-imported ${files.length} sheet(s)`,
      files,
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
        return NextResponse.json({ success: false, message }, { status: 400 });
      }
    }
    return handleApiError(error);
  }
});
