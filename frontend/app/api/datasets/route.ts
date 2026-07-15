import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { processFilesFromS3 } from '@/lib/csv-processor';
import { verifyStorageToken } from '@/lib/object-store/key-token';
import { FilesAPI } from '@/lib/data/files.server';
import { UserFacingError } from '@/lib/errors';
import type { DatasetContent, DatasetTable } from '@/lib/types/datasets';

/**
 * POST /api/datasets — create a dataset FILE from uploaded objects.
 *
 * The self-serve seam of static-data-as-files: an EDITOR uploads CSV/XLSX (or
 * imports a link source) into their own folder and can query the tables
 * immediately — no admin, no connection. All enforcement lives in the layers
 * this route delegates to:
 *   - storage tokens prove each s3_key was minted by this server;
 *   - processFilesFromS3 expands xlsx, sniffs columns, assigns table names;
 *   - FilesAPI.createFile applies role/location permissions AND the dataset
 *     gate (global schema.table uniqueness), and creates the doc LIVE.
 *
 * Body: { path: '/org/sales', name: 'pipeline', description?, source_url?,
 *         files: [{ s3_key: <token>, filename, schema_name?, table_name? }] }
 */
export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { path, name, description, source_url } = body as {
      path?: string; name?: string; description?: string; source_url?: string;
    };
    const files = body.files as Array<{ s3_key: string; filename: string; schema_name?: string; table_name?: string }> | undefined;

    if (!path || !name) return ApiErrors.badRequest('path and name are required');
    if (!files?.length) return ApiErrors.badRequest('At least one file is required');

    // Verify each s3_key token — proves it was issued by this server.
    const verifiedFiles = files.map((f) => ({ ...f, s3_key: verifyStorageToken(f.s3_key) }));

    const registered = await processFilesFromS3(user.mode, name, verifiedFiles);

    const tables: DatasetTable[] = registered.map((r) => ({
      filename: r.filename, table_name: r.table_name, schema_name: r.schema_name,
      s3_key: r.s3_key, file_format: r.file_format, row_count: r.row_count,
      columns: r.columns,
      source: source_url ? 'link' : 'upload',
      ...(source_url ? { source_url } : {}),
    }));

    const content: DatasetContent = { ...(description ? { description } : {}), files: tables };
    const created = await FilesAPI.createFile({
      name, path: `${path.replace(/\/+$/, '')}/${name}`, type: 'dataset',
      content: content as never, references: [],
    }, user);

    return NextResponse.json({ success: true, data: { id: created.data.id, tables } });
  } catch (error) {
    // Permission/uniqueness/location failures are user errors, not 500s.
    if (error instanceof UserFacingError) {
      return ApiErrors.badRequest(error.message);
    }
    if (error instanceof Error && (error.message.includes('not configured') || error.message.includes('storage token'))) {
      return ApiErrors.badRequest(error.message);
    }
    return handleApiError(error);
  }
});
