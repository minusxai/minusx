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

      try {
        const { files: incoming, spreadsheetId: parsedId } = await importGoogleSheetToS3(
          spreadsheetUrl, connFile.name, user.mode, schemaName,
        );
        const registered = await processFilesFromS3(user.mode, connFile.name, incoming);

        const newFiles: CsvFileInfo[] = registered.map((f) => {
          // Same tab as before → keep the user's table/schema renames
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

        const firstIdx = updatedFiles.findIndex((f) => f.spreadsheet_id === spreadsheetId);
        const unchanged = updatedFiles.filter((f) => f.spreadsheet_id !== spreadsheetId);
        updatedFiles = firstIdx === -1
          ? [...newFiles, ...unchanged]
          : [...unchanged.slice(0, firstIdx), ...newFiles, ...unchanged.slice(firstIdx)];

        // Best-effort cleanup, only after new data is confirmed
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
    // saveFile re-introspects connection schemas, so new tables are profiled here
    await FilesAPI.saveFile(fileId, connFile.name, connFile.path, updatedContent, connFile.references ?? [], user);

    return {
      output: { results, synced: results.length - failures.length, failed: failures.length },
      messages: [],
      status: failures.length > 0 ? 'failure' : 'success',
    };
  },
};
