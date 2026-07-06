import { NextRequest } from 'next/server';
import { successResponse, handleApiError } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { getRelevantFiles } from '@/lib/analytics/file-analytics.server';
import { loadFiles } from '@/lib/data/files.server';
import type { RecentFile } from '@/lib/analytics/file-analytics.types';

export const GET = withAuth(async (_request: NextRequest, user) => {
  try {
    const recent = await getRelevantFiles(user.email, user.mode, 30, 5);

    // Cross-reference against live DB — filter out deleted/draft files, update names
    const fileIds = recent.map(f => f.fileId);
    const publishedFileIds = new Set<number>();
    const fileNameMap = new Map<number, string>();
    const vizTypeMap = new Map<number, string>();
    if (fileIds.length > 0) {
      const result = await loadFiles(fileIds, user);
      for (const file of result.data) {
        if (!file.draft) {
          publishedFileIds.add(file.id);
        }
        fileNameMap.set(file.id, file.name);
        const vizType = (file.content as { vizSettings?: { type?: string } } | undefined)?.vizSettings?.type;
        if (vizType) vizTypeMap.set(file.id, vizType);
      }
    }

    const filtered: RecentFile[] = recent
      .filter(f => publishedFileIds.has(f.fileId))
      .map(f => ({ ...f, fileName: fileNameMap.get(f.fileId) ?? f.fileName, vizType: vizTypeMap.get(f.fileId) }));

    return successResponse({
      recent: filtered,
      trending: [],
    });
  } catch (error) {
    return handleApiError(error);
  }
});
