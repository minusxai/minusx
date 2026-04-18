import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { processFilesFromS3 } from '@/lib/csv-processor';
import { verifyStorageToken } from '@/lib/object-store/key-token';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { connection_name, files } = body;

    if (!files?.length) return ApiErrors.badRequest('At least one file is required');

    // Verify each s3_key token — proves it was issued by this server for this company.
    const verifiedFiles = files.map((f: { s3_key: string; [k: string]: unknown }) => ({
      ...f,
      s3_key: verifyStorageToken(f.s3_key, user.companyId),
    }));

    const registered = await processFilesFromS3(user.companyId, user.mode, connection_name, verifiedFiles);

    return NextResponse.json({
      success: true,
      message: `Successfully registered ${registered.length} file(s)`,
      config: { files: registered },
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('not configured') || error.message.includes('collision') || error.message.includes('storage token'))) {
      return NextResponse.json({ success: false, message: error.message, config: null }, { status: 400 });
    }
    return handleApiError(error);
  }
});
