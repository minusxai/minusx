import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { deleteS3File, importGoogleSheetToS3, processFilesFromS3 } from '@/lib/csv-processor';
import type { JobHandler } from '../job-registry';
import type { ConnectionContent, CsvFileInfo, JobHandlerResult, JobRunnerInput } from '@/lib/types';

interface SheetSyncResult {
  spreadsheet_id: string;
  spreadsheet_url: string;
  status: 'success' | 'error';
  tables?: string[];
  error?: string;
}

/**
 * Resyncs every Google Sheets-sourced file group in a connection from its
 * live spreadsheet. Mirrors the manual reimport flow
 * (app/api/google-sheets/reimport/route.ts) with the same atomicity rule:
 * new data is fetched and validated BEFORE old S3 files are deleted, so a
 * failed sync always leaves the previous data intact.
 *
 * On top of manual reimport, this preserves user table renames across syncs
 * by matching files on `filename` (the sheet tab) — an unattended 3am sync
 * must not silently break saved questions that reference a renamed table.
 */
export const sheetsSyncJobHandler: JobHandler = {
  async execute({ jobId, file }: JobRunnerInput, user): Promise<JobHandlerResult> {
    const connection = file as ConnectionContent;
    const fileId = parseInt(jobId, 10);
    const { data: connFile } = await FilesAPI.loadFile(fileId, user);
    if (!connFile) throw new Error(`Connection file ${jobId} not found`);

    const allFiles = ((connection.config?.files ?? []) as CsvFileInfo[]);

    // Group sheet-sourced files by spreadsheet (one connection can hold
    // several imported spreadsheets alongside plain CSV uploads)
    const groups = new Map<string, CsvFileInfo[]>();
    for (const f of allFiles) {
      if (f.source_type === 'google_sheets' && f.spreadsheet_id) {
        groups.set(f.spreadsheet_id, [...(groups.get(f.spreadsheet_id) ?? []), f]);
      }
    }
    if (groups.size === 0) throw new Error('Connection has no Google Sheets files to sync');

    let updatedFiles = [...allFiles];
    const results: SheetSyncResult[] = [];

    for (const [spreadsheetId, groupFiles] of groups) {
      const spreadsheetUrl = groupFiles[0].spreadsheet_url ?? '';
      const schemaName = groupFiles[0].schema_name ?? 'public';
      const oldS3Keys = groupFiles.map((f) => f.s3_key);

      try {
        const { files: incoming, spreadsheetId: parsedId } = await importGoogleSheetToS3(
          spreadsheetUrl, connFile.name, user.mode, schemaName,
        );
        const registered = await processFilesFromS3(user.mode, connFile.name, incoming);

        const newFiles: CsvFileInfo[] = registered.map((f) => {
          // Same tab (filename) as before → keep the user's table/schema names
          const previous = groupFiles.find((old) => old.filename === f.filename);
          return {
            ...f,
            table_name: previous?.table_name ?? f.table_name,
            schema_name: previous?.schema_name ?? f.schema_name,
            source_type: 'google_sheets' as const,
            spreadsheet_url: spreadsheetUrl,
            spreadsheet_id: parsedId,
          };
        });

        // Replace the group in place, keeping its position in the file list
        const firstIdx = updatedFiles.findIndex((f) => f.spreadsheet_id === spreadsheetId);
        const unchanged = updatedFiles.filter((f) => f.spreadsheet_id !== spreadsheetId);
        updatedFiles = firstIdx === -1
          ? [...newFiles, ...unchanged]
          : [...unchanged.slice(0, firstIdx), ...newFiles, ...unchanged.slice(firstIdx)];

        // New data confirmed — delete old S3 objects (best-effort, non-fatal)
        await Promise.allSettled(oldS3Keys.map((key) => deleteS3File(key)));

        results.push({
          spreadsheet_id: parsedId,
          spreadsheet_url: spreadsheetUrl,
          status: 'success',
          tables: newFiles.map((f) => `${f.schema_name}.${f.table_name}`),
        });
      } catch (err) {
        results.push({
          spreadsheet_id: spreadsheetId,
          spreadsheet_url: spreadsheetUrl,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const failures = results.filter((r) => r.status === 'error');
    const anySuccess = failures.length < results.length;

    const updatedContent: ConnectionContent = {
      ...connection,
      config: { ...connection.config, files: updatedFiles },
      ...(anySuccess ? { lastSyncedAt: new Date().toISOString() } : {}),
      lastSyncError: failures.length > 0
        ? failures.map((f) => `${f.spreadsheet_url}: ${f.error}`).join('; ')
        : undefined,
    };
    // FilesAPI.saveFile owns the schema cache for connections: it strips the
    // cached schema and re-introspects with refresh=true, so the new tables
    // are profiled immediately after the sync.
    await FilesAPI.saveFile(fileId, connFile.name, connFile.path, updatedContent, connFile.references ?? [], user);

    return {
      output: { results, synced: results.length - failures.length, failed: failures.length },
      messages: [],
      status: failures.length > 0 ? 'failure' : 'success',
    };
  },
};
