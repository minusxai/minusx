/**
 * Scheduled Google-Sheets auto-sync must honor the user's deletions: re-syncing a sheet whose live
 * source still has a tab the user deleted must NOT resurrect that tab (same guarantee as the manual
 * Re-import button). The S3 / DB boundaries are mocked; the real mergeReimportedSheetFiles runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CsvFileInfo, ConnectionContent } from '@/lib/types';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    importGoogleSheetToS3: vi.fn(),
    processFilesFromS3: vi.fn(),
    deleteS3File: vi.fn(),
    loadFile: vi.fn(),
    saveFile: vi.fn(),
  },
}));

vi.mock('@/lib/csv-processor', () => ({
  importGoogleSheetToS3: mocks.importGoogleSheetToS3,
  processFilesFromS3: mocks.processFilesFromS3,
  deleteS3File: mocks.deleteS3File,
}));
vi.mock('@/lib/data/files.server', () => ({
  FilesAPI: { loadFile: mocks.loadFile, saveFile: mocks.saveFile },
}));

import { sheetsSyncJobHandler } from '@/lib/jobs/handlers/sheets-sync-handler';

const user = { userId: 1, email: 'a@x.com', name: 'A', role: 'admin', mode: 'org', home_folder: '' } as any;

function sheetFile(filename: string, table_name: string, s3_key: string, row_count = 0): CsvFileInfo {
  return {
    filename, table_name, schema_name: 'public', s3_key, file_format: 'csv', row_count, columns: [],
    source_type: 'google_sheets', spreadsheet_url: 'https://docs.google.com/spreadsheets/d/A', spreadsheet_id: 'A',
  };
}

describe('sheetsSyncJobHandler — scheduled sync preserves deletions', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.deleteS3File.mockResolvedValue(undefined);
    mocks.loadFile.mockResolvedValue({ data: { name: 'static', path: '/org/database/static', references: [] } });
    mocks.saveFile.mockResolvedValue(undefined);
  });

  it('does NOT resurrect a tab the user deleted (live sheet still has it)', async () => {
    // The connection currently has only companies_1 — the user deleted companies_2.
    const content: ConnectionContent = {
      type: 'csv',
      config: { files: [sheetFile('companies_1.csv', 'companies_1', 'old1', 5)] },
    } as unknown as ConnectionContent;

    // The LIVE sheet still has both tabs, so the import returns both.
    mocks.importGoogleSheetToS3.mockResolvedValue({
      files: [{ filename: 'companies_1.csv', s3_key: 'fresh1' }, { filename: 'companies_2.csv', s3_key: 'fresh2' }],
      spreadsheetId: 'A',
    });
    mocks.processFilesFromS3.mockResolvedValue([
      { filename: 'companies_1.csv', table_name: 'companies_1', schema_name: 'public', s3_key: 'fresh1', file_format: 'csv', row_count: 17, columns: [] },
      { filename: 'companies_2.csv', table_name: 'companies_2', schema_name: 'public', s3_key: 'fresh2', file_format: 'csv', row_count: 32, columns: [] },
    ]);

    await sheetsSyncJobHandler.execute(
      { runFileId: 6, jobId: '6', jobType: 'sheets_sync', file: content, previousRuns: [] },
      user,
    );

    expect(mocks.saveFile).toHaveBeenCalledTimes(1);
    const savedContent = mocks.saveFile.mock.calls[0][3] as ConnectionContent;
    const savedFiles = (savedContent.config?.files ?? []) as CsvFileInfo[];

    expect(savedFiles.map((f) => f.filename)).toEqual(['companies_1.csv']); // companies_2 NOT resurrected
    expect(savedFiles[0].s3_key).toBe('fresh1');                            // kept tab refreshed
    expect(savedFiles[0].row_count).toBe(17);
    // The orphaned fresh upload for the deleted tab is cleaned up from S3.
    expect(mocks.deleteS3File).toHaveBeenCalledWith('fresh2');
  });
});
