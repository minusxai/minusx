import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import {
  deleteS3File,
  importGoogleSheetToS3,
  processFilesFromS3,
  downloadSpreadsheetAsXlsx,
  parseSpreadsheetId,
} from '@/lib/csv-processor';
import { extractRawGrids } from '@/lib/sheets-import/raw-grid';
import { materializeTransforms } from '@/lib/sheets-import/executor';
import { mergeReimportedSheetFiles } from '@/lib/data/helpers/sheet-reimport';
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
 * Resyncs each Google Sheets group in a connection from its live spreadsheet.
 * Same atomicity rule as manual reimport: new data is validated before old S3
 * files are deleted, so a failed sync keeps the previous data.
 */
export const sheetsSyncJobHandler: JobHandler = {
  async execute({ jobId, file }: JobRunnerInput, user): Promise<JobHandlerResult> {
    const connection = file as ConnectionContent;
    const fileId = parseInt(jobId, 10);
    const { data: connFile } = await FilesAPI.loadFile(fileId, user);
    if (!connFile) throw new Error(`Connection file ${jobId} not found`);

    const allFiles = ((connection.config?.files ?? []) as CsvFileInfo[]);

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

      // Agentic group: every table in it was produced by an agent-authored transform. Resync
      // re-extracts the raw grids from the LIVE sheet and re-runs the SAME transform SQL, so
      // refreshed data flows through the identical cleaning (table detection / unpivot / value
      // cleaning). Legacy (or mixed) groups keep the plain per-tab reimport path.
      const groupTransforms = groupFiles.map((f) => f.transform).filter((t): t is NonNullable<typeof t> => !!t);
      const isAgenticGroup = groupTransforms.length > 0 && groupTransforms.length === groupFiles.length;

      try {
        let reimported: CsvFileInfo[];
        let parsedId: string;
        if (isAgenticGroup) {
          parsedId = parseSpreadsheetId(spreadsheetUrl);
          const xlsx = await downloadSpreadsheetAsXlsx(parsedId);
          const rawKeys: string[] = [];
          try {
            const rawFiles = await extractRawGrids(xlsx, connFile.name, user.mode, rawKeys);
            const registered = await materializeTransforms(user.mode, connFile.name, rawFiles, groupTransforms);
            const byTable = new Map(groupTransforms.map((t) => [t.output_table, t]));
            reimported = registered.map((f) => ({
              ...f,
              source_type: 'google_sheets' as const,
              spreadsheet_url: spreadsheetUrl,
              spreadsheet_id: parsedId,
              transform: byTable.get(f.table_name),
            }));
          } finally {
            // Raw grids are transient — always cleaned up, success or failure.
            await Promise.allSettled(rawKeys.map((key) => deleteS3File(key)));
          }
        } else {
          const imported = await importGoogleSheetToS3(spreadsheetUrl, connFile.name, user.mode, schemaName);
          parsedId = imported.spreadsheetId;
          const registered = await processFilesFromS3(user.mode, connFile.name, imported.files);
          reimported = registered.map((f) => ({
            ...f,
            source_type: 'google_sheets' as const,
            spreadsheet_url: spreadsheetUrl,
            spreadsheet_id: parsedId,
          }));
        }

        // Refresh the tabs the user still has — preserving deletions AND renames — instead of
        // blindly replacing the group with every live tab (which resurrected deleted tabs; the same
        // bug fixed for the manual Re-import button). Shared with the UI via mergeReimportedSheetFiles.
        updatedFiles = mergeReimportedSheetFiles(updatedFiles, spreadsheetId, reimported);

        // Best-effort S3 cleanup, only after new data is confirmed: delete every old key that was
        // replaced AND every freshly-uploaded key we did NOT keep (importGoogleSheetToS3 uploads ALL
        // live tabs, including deleted/new ones we drop). Keep only the keys still referenced.
        const referenced = new Set(updatedFiles.filter((f) => f.spreadsheet_id === spreadsheetId).map((f) => f.s3_key));
        const garbage = [...oldS3Keys, ...reimported.map((f) => f.s3_key)].filter((k) => !referenced.has(k));
        await Promise.allSettled(garbage.map((key) => deleteS3File(key)));

        results.push({
          spreadsheet_id: parsedId,
          spreadsheet_url: spreadsheetUrl,
          status: 'success',
          tables: updatedFiles.filter((f) => f.spreadsheet_id === spreadsheetId).map((f) => `${f.schema_name}.${f.table_name}`),
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
    // saveFile re-introspects connection schemas, so new tables are profiled here
    await FilesAPI.saveFile(fileId, connFile.name, connFile.path, updatedContent, connFile.references ?? [], user);

    return {
      output: { results, synced: results.length - failures.length, failed: failures.length },
      messages: [],
      status: failures.length > 0 ? 'failure' : 'success',
    };
  },
};
