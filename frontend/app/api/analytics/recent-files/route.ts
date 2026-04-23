import { NextRequest } from 'next/server';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { getRelevantFiles, getPopularFiles } from '@/lib/analytics/file-analytics.server';
import { loadFiles } from '@/lib/data/files.server';
import type { RecentFile } from '@/lib/analytics/file-analytics.types';

export const GET = withAuth(async (_request: NextRequest, user) => {
  try {
    const [recent, trendingRaw] = await Promise.all([
      getRelevantFiles(user.email, 30, 3),
      getPopularFiles(7, 3),
    ]);

    // Deduplicate trending: exclude files already in recent
    const recentIds = new Set(recent.map(f => f.fileId));
    const trending = trendingRaw.filter(f => !recentIds.has(f.fileId));

    // Collect all unique file IDs to cross-reference against live DB
    const allFileIds = [...new Set([
      ...recent.map(f => f.fileId),
      ...trending.map(f => f.fileId),
    ])];

    // Check which files still exist and get current names
    const existingFileIds = new Set<number>();
    const fileNameMap = new Map<number, string>();
    if (allFileIds.length > 0) {
      const result = await loadFiles(allFileIds, user);
      for (const file of result.data) {
        existingFileIds.add(file.id);
        fileNameMap.set(file.id, file.name);
      }
    }

    const filterAndUpdate = (files: RecentFile[]): RecentFile[] =>
      files
        .filter(f => existingFileIds.has(f.fileId))
        .map(f => ({ ...f, fileName: fileNameMap.get(f.fileId) ?? f.fileName }));

    return successResponse({
      recent: filterAndUpdate(recent),
      trending: filterAndUpdate(trending),
    });
  } catch (error) {
    return handleApiError(error);
  }
});
