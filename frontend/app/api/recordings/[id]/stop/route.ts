import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { stopRecording } from '@/lib/recordings';

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

    if (!user || !user.companyId) {
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
    console.error('[POST /api/recordings/[id]/stop] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to stop recording' },
      { status: 500 }
    );
  }
}
