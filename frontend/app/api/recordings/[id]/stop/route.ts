import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { stopRecording } from '@/lib/recordings';
import { handleApiError } from '@/lib/api/api-responses';

/**
 * POST /api/recordings/[id]/stop
 * Stop active recording
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getEffectiveUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const fileId = parseInt(id, 10);
    if (isNaN(fileId)) {
      return NextResponse.json(
        { error: 'Invalid recording ID' },
        { status: 400 }
      );
    }

    // Stop recording
    const result = await stopRecording(fileId, user);

    return NextResponse.json(result);

  } catch (error: any) {
    return handleApiError(error);
  }
}
