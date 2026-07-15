import 'server-only';

/**
 * Link-source re-import for DATASETS — the one implementation behind both the
 * manual Re-import button (PATCH /api/datasets/[id]) and the scheduled
 * sheets_sync job.
 *
 * Merge semantics (ported from the legacy connection reimport, where blind
 * group replacement resurrected deleted tabs): refresh only the tables the
 * dataset still has — deletions stay deleted, renames stay renamed, tabs
 * removed from the live source are dropped. New data is registered BEFORE any
 * old object is deleted, so a failed sync keeps the previous data.
 */

import { deleteS3File, importGoogleSheetToS3, processFilesFromS3 } from '@/lib/csv-processor';
import type { DatasetContent, DatasetTable } from '@/lib/types/datasets';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/** Refresh the data fields of a link group from a fresh snapshot; preserve names + membership. */
export function mergeReimportedTables(
  existing: DatasetTable[],
  sourceGroup: string,
  reimported: DatasetTable[],
): DatasetTable[] {
  const freshByFilename = new Map(reimported.map((f) => [f.filename, f]));
  const out: DatasetTable[] = [];
  for (const t of existing) {
    if (t.source_group !== sourceGroup) { out.push(t); continue; }
    const fresh = freshByFilename.get(t.filename);
    if (!fresh) continue; // removed from the live source → drop
    out.push({ ...t, s3_key: fresh.s3_key, columns: fresh.columns, row_count: fresh.row_count, file_format: fresh.file_format });
  }
  return out;
}

export interface LinkGroupSyncResult {
  source_group: string;
  source_url: string;
  status: 'success' | 'error';
  tables?: string[];
  error?: string;
}

/**
 * Re-snapshot ONE link group of a dataset. Returns the next `files` array and
 * a result record; deletes every object no longer referenced (old keys +
 * fresh uploads that the merge dropped) only after the new data registered.
 */
export async function reimportLinkGroup(
  datasetName: string,
  currentFiles: DatasetTable[],
  sourceGroup: string,
  user: EffectiveUser,
): Promise<{ files: DatasetTable[]; result: LinkGroupSyncResult }> {
  const groupTables = currentFiles.filter((t) => t.source === 'link' && t.source_group === sourceGroup);
  const sourceUrl = groupTables[0]?.source_url ?? '';
  const schemaName = groupTables[0]?.schema_name ?? 'public';
  const oldKeys = groupTables.map((t) => t.s3_key);

  try {
    if (!sourceUrl) throw new Error('no link source with that group');
    const { files: incoming, spreadsheetId } = await importGoogleSheetToS3(sourceUrl, datasetName, user.mode, schemaName);
    const registered = await processFilesFromS3(user.mode, datasetName, incoming);
    const reimported: DatasetTable[] = registered.map((r) => ({
      filename: r.filename, table_name: r.table_name, schema_name: r.schema_name,
      s3_key: r.s3_key, file_format: r.file_format, row_count: r.row_count,
      columns: r.columns, source: 'link', source_url: sourceUrl, source_group: spreadsheetId,
    }));

    const files = mergeReimportedTables(currentFiles, sourceGroup, reimported);

    const referenced = new Set(files.filter((t) => t.source_group === sourceGroup).map((t) => t.s3_key));
    const garbage = [...oldKeys, ...reimported.map((t) => t.s3_key)].filter((k) => !referenced.has(k));
    await Promise.allSettled(garbage.map((key) => deleteS3File(key)));

    return {
      files,
      result: {
        source_group: sourceGroup, source_url: sourceUrl, status: 'success',
        tables: files.filter((t) => t.source_group === sourceGroup).map((t) => `${t.schema_name}.${t.table_name}`),
      },
    };
  } catch (err) {
    return {
      files: currentFiles,
      result: {
        source_group: sourceGroup, source_url: sourceUrl, status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    };
  }
}

/** The distinct link groups of a dataset. */
export function linkGroupsOf(content: DatasetContent): string[] {
  return [...new Set((content.files ?? [])
    .filter((t) => t.source === 'link' && t.source_group)
    .map((t) => t.source_group!))];
}
