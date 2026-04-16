import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { processFilesFromS3 } from '@/lib/csv-processor';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { connection_name, files } = body;

    if (!files?.length) return ApiErrors.badRequest('At least one file is required');

    const registered = await processFilesFromS3(user.companyId, user.mode, connection_name, files);

    return NextResponse.json({
      success: true,
      message: `Successfully registered ${registered.length} file(s)`,
      config: { files: registered },
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('not configured') || error.message.includes('collision'))) {
      return NextResponse.json({ success: false, message: error.message, config: null }, { status: 400 });
    }
    return handleApiError(error);
  }
});
