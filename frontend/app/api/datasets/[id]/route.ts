import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { processFilesFromS3, deleteS3File } from '@/lib/csv-processor';
import { reimportLinkGroup } from '@/lib/data/dataset-sync.server';
import { verifyStorageToken } from '@/lib/object-store/key-token';
import { FilesAPI } from '@/lib/data/files.server';
import { UserFacingError } from '@/lib/errors';
import { tableKey } from '@/lib/types/datasets';
import type { DatasetContent, DatasetTable } from '@/lib/types/datasets';

/**
 * PATCH /api/datasets/[id] — dataset lifecycle, all through FilesAPI.saveFile
 * so role/folder permissions AND the global-name gate apply unchanged:
 *
 *  - { action: 'add-files', files: [{ s3_key: <token>, filename, … }] }
 *      append uploaded tables (columns sniffed server-side)
 *  - { action: 'delete-table', table: 'schema.table' }
 *      remove the table and delete its S3 object — the key comes from the DOC,
 *      never from the client (the legacy delete-file route trusted client keys;
 *      this endpoint must not)
 *  - { action: 'reimport', source_group }
 *      re-snapshot a LINK group from its source_url, replace its tables,
 *      clean up the stale objects
 */
export const PATCH = withAuth(async (request: NextRequest, user, context?: { params?: Promise<{ id: string }> }) => {
  try {
    const { id: idParam } = (await context?.params) ?? {};
    const fileId = Number(idParam);
    if (!Number.isFinite(fileId)) return ApiErrors.badRequest('invalid dataset id');

    const body = await request.json();
    const action = body.action as string;

    const { data: file } = await FilesAPI.loadFile(fileId, user);
    if (file.type !== 'dataset') return ApiErrors.badRequest('not a dataset');
    const current = file.content as DatasetContent;

    let nextFiles: DatasetTable[];
    const staleKeys: string[] = [];

    if (action === 'add-files') {
      const uploads = body.files as Array<{ s3_key: string; filename: string; schema_name?: string; table_name?: string }> | undefined;
      if (!uploads?.length) return ApiErrors.badRequest('files required');
      const verified = uploads.map((f) => ({ ...f, s3_key: verifyStorageToken(f.s3_key) }));
      const registered = await processFilesFromS3(user.mode, file.name, verified);
      nextFiles = [
        ...(current.files ?? []),
        ...registered.map((r): DatasetTable => ({
          filename: r.filename, table_name: r.table_name, schema_name: r.schema_name,
          s3_key: r.s3_key, file_format: r.file_format, row_count: r.row_count,
          columns: r.columns, source: 'upload',
        })),
      ];
    } else if (action === 'delete-table') {
      const key = body.table as string;
      const target = (current.files ?? []).find((t) => tableKey(t) === key);
      if (!target) return ApiErrors.badRequest(`no table '${key}' in this dataset`);
      nextFiles = (current.files ?? []).filter((t) => tableKey(t) !== key);
      staleKeys.push(target.s3_key);
    } else if (action === 'reimport') {
      const group = body.source_group as string;
      // Shared with the scheduled sheets_sync job: merge semantics preserve the
      // user's deletions/renames, and cleanup happens inside only on success.
      const { files, result } = await reimportLinkGroup(file.name, current.files ?? [], group, user);
      if (result.status === 'error') return ApiErrors.badRequest(result.error ?? 'Re-import failed');
      nextFiles = files;
    } else {
      return ApiErrors.badRequest(`unknown action '${String(action)}'`);
    }

    // Permissions + global-name gate fire here (excludeFileId keeps reimport's
    // same-name replacement from colliding with itself).
    const nextContent: DatasetContent = { ...current, files: nextFiles };
    await FilesAPI.saveFile(fileId, file.name, file.path, nextContent as never, [], user);

    // Only after the doc save landed: clean up stale objects (best-effort).
    for (const key of staleKeys) {
      await deleteS3File(key).catch((e) => console.warn(`[datasets] cleanup failed for ${key}:`, e));
    }

    return NextResponse.json({ success: true, data: { tables: nextFiles } });
  } catch (error) {
    if (error instanceof UserFacingError) return ApiErrors.badRequest(error.message);
    if (error instanceof Error && error.message.includes('storage token')) return ApiErrors.badRequest(error.message);
    return handleApiError(error);
  }
});
