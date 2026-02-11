import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { appendEvents, RRWebEvent } from '@/lib/recordings';

/**
 * POST /api/recordings/[id]/events
 * Append events to existing recording
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

    const body = await request.json();
    const { events } = body as { events: RRWebEvent[] };

    if (!Array.isArray(events)) {
      return NextResponse.json(
        { error: 'Invalid events array' },
        { status: 400 }
      );
    }

    // Append events to recording
    const result = await appendEvents(fileId, events, user);

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('[POST /api/recordings/[id]/events] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to append events' },
      { status: 500 }
    );
  }
}
