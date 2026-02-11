import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { createRecording } from '@/lib/recordings';
import { FilesAPI } from '@/lib/data/files.server';
import { SessionRecordingFileContent, FileType } from '@/lib/types';
import { resolvePath } from '@/lib/mode/path-resolver';

/**
 * POST /api/recordings
 * Create new recording file
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getEffectiveUser();

    if (!user || !user.companyId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { pageType } = body as { pageType: FileType | 'explore' };

    // Create recording file
    const { fileId, path } = await createRecording(pageType, user);

    return NextResponse.json({ id: fileId, path });

  } catch (error: any) {
    console.error('[POST /api/recordings] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create recording' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/recordings
 * List user's recordings
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getEffectiveUser();

    if (!user || !user.companyId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get query params
    const { searchParams } = new URL(request.url);
    const pageType = searchParams.get('pageType') as FileType | 'explore' | null;

    // Derive userId
    const userId = user.userId?.toString() || user.email;

    // Get all recording files for this user
    const recordingsPath = resolvePath(user.mode, `/logs/recordings/${userId}`);
    const filesResult = await FilesAPI.getFiles({
      type: 'session',
      paths: [recordingsPath],
      depth: 2
    }, user);

    // Parse and summarize recordings
    const recordings = [];

    for (const fileInfo of filesResult.data) {
      try {
        const fileResult = await FilesAPI.loadFile(fileInfo.id, user);
        const content = fileResult.data.content as unknown as SessionRecordingFileContent;

        // Filter by pageType if provided
        if (pageType && content.metadata.pageType !== pageType) {
          continue;
        }

        recordings.push({
          id: fileInfo.id,
          name: fileResult.data.name,  // Use file.name (metadata), not content.name
          duration: content.metadata.duration,
          createdAt: content.metadata.recordedAt,
          pageType: content.metadata.pageType,
          eventCount: content.metadata.eventCount,
          size: content.metadata.compressedSize || 0
        });
      } catch (error) {
        console.error(`Failed to load recording ${fileInfo.id}:`, error);
        continue;
      }
    }

    // Sort by date (most recent first)
    recordings.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({ recordings });

  } catch (error: any) {
    console.error('[GET /api/recordings] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list recordings' },
      { status: 500 }
    );
  }
}
