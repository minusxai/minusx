/**
 * SheetsAddPanel — agentic import path on the static connection's "Add Google Sheet" tab.
 * The user enters a URL + dataset name, clicks "Import with agent"; the agent's proposed
 * transforms come back for review (SheetImportReview), and confirming materializes only the
 * included tables and persists them onto the connection. Client API is mocked at the module
 * boundary; the real SheetImportReview renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SheetsAddPanel } from '@/components/views/connection-configs/SheetsAddPanel';
import type { CsvFileInfo } from '@/lib/types';

const { api } = vi.hoisted(() => ({
  api: {
    importGoogleSheets: vi.fn(),
    analyzeGoogleSheet: vi.fn(),
    reviseGoogleSheetTransforms: vi.fn(),
    confirmGoogleSheetImport: vi.fn(),
  },
}));
vi.mock('@/lib/connections/client/google-sheets', () => api);

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/TEST123/edit';

const transform = (name: string) => ({
  output_table: name,
  schema_name: 'public',
  source_tables: ['l1_consol'],
  sql: `SELECT B AS line_item FROM raw.l1_consol -- ${name}`,
  description: `Cleans ${name}.`,
});
const preview = {
  columns: [{ name: 'line_item', type: 'VARCHAR' }],
  rows: [{ line_item: 'Revenue' }],
  row_count: 4,
};
const analysis = {
  spreadsheet_id: 'TEST123',
  raw_files: [{ tab_name: 'L1', table_name: 'l1_consol', s3_key: 'csvs/org/static/raw/g1.parquet', n_rows: 9, n_cols: 4 }],
  transforms: [transform('pnl_long'), transform('zones_clean')],
  previews: { pnl_long: preview, zones_clean: preview },
  dropped: [],
};

const existingFile: CsvFileInfo = {
  filename: 'old.csv', table_name: 'old', schema_name: 'public', s3_key: 'old', file_format: 'csv', row_count: 1, columns: [],
};

function setup() {
  const props = {
    isActive: true,
    existingFiles: [existingFile],
    onChange: vi.fn(),
    onError: vi.fn(),
    pendingSheets: [{ url: SHEET_URL, schema: 'finance', tableName: '' }],
    setPendingSheets: vi.fn(),
    importProgress: 'idle' as const,
    setImportProgress: vi.fn(),
    setActivePanel: vi.fn(),
    setTablesOpen: vi.fn(),
    setCollapsedSchemas: vi.fn(),
  };
  renderWithProviders(<SheetsAddPanel {...props} />);
  return props;
}

describe('SheetsAddPanel — agentic import', () => {
  beforeEach(() => {
    Object.values(api).forEach((m) => m.mockReset());
  });

  it('analyzes the sheet with the agent and shows the review step', async () => {
    api.analyzeGoogleSheet.mockResolvedValue({ success: true, message: 'ok', data: analysis });
    setup();
    await userEvent.click(screen.getByLabelText('Import with agent'));
    expect(api.analyzeGoogleSheet).toHaveBeenCalledWith('static', SHEET_URL);
    await waitFor(() => expect(screen.getByLabelText('Preview of pnl_long')).toBeTruthy());
    // Dataset name overrides the agent's default schema on the proposals shown.
    expect(screen.getByText('finance.pnl_long')).toBeTruthy();
  });

  it('confirming imports only the included tables and persists them onto the connection', async () => {
    api.analyzeGoogleSheet.mockResolvedValue({ success: true, message: 'ok', data: analysis });
    const files: CsvFileInfo[] = [{
      filename: 'pnl_long.parquet', table_name: 'pnl_long', schema_name: 'finance', s3_key: 'new1',
      file_format: 'parquet', row_count: 4, columns: [],
      source_type: 'google_sheets', spreadsheet_url: SHEET_URL, spreadsheet_id: 'TEST123',
      transform: { ...transform('pnl_long'), schema_name: 'finance' },
    }];
    api.confirmGoogleSheetImport.mockResolvedValue({
      success: true, message: 'ok', data: { files, spreadsheet_url: SHEET_URL, spreadsheet_id: 'TEST123' },
    });
    const props = setup();

    await userEvent.click(screen.getByLabelText('Import with agent'));
    await waitFor(() => expect(screen.getByLabelText('Preview of pnl_long')).toBeTruthy());
    await userEvent.click(screen.getByLabelText('Include table zones_clean')); // redact one
    await userEvent.click(screen.getByLabelText('Import 1 tables'));

    await waitFor(() => expect(api.confirmGoogleSheetImport).toHaveBeenCalled());
    const [conn, url, rawFiles, transforms] = api.confirmGoogleSheetImport.mock.calls[0];
    expect(conn).toBe('static');
    expect(url).toBe(SHEET_URL);
    expect(rawFiles).toEqual(analysis.raw_files);
    expect(transforms).toHaveLength(1);
    expect(transforms[0]).toMatchObject({ output_table: 'pnl_long', schema_name: 'finance' });

    // New files prepended to existing ones, existing preserved.
    await waitFor(() => expect(props.onChange).toHaveBeenCalledWith({ files: [...files, existingFile] }));
    expect(props.setActivePanel).toHaveBeenCalledWith('csv-upload');
  });

  it('revising sends feedback along with the current transforms', async () => {
    api.analyzeGoogleSheet.mockResolvedValue({ success: true, message: 'ok', data: analysis });
    api.reviseGoogleSheetTransforms.mockResolvedValue({
      success: true, message: 'ok',
      data: { ...analysis, transforms: [transform('pnl_v2')], previews: { pnl_v2: preview } },
    });
    setup();

    await userEvent.click(screen.getByLabelText('Import with agent'));
    await waitFor(() => expect(screen.getByLabelText('Preview of pnl_long')).toBeTruthy());
    await userEvent.type(screen.getByLabelText('Feedback for the agent'), 'rename it pnl_v2');
    await userEvent.click(screen.getByLabelText('Revise with agent'));

    await waitFor(() => expect(api.reviseGoogleSheetTransforms).toHaveBeenCalled());
    const [conn, rawFiles, transforms, feedback] = api.reviseGoogleSheetTransforms.mock.calls[0];
    expect(conn).toBe('static');
    expect(rawFiles).toEqual(analysis.raw_files);
    expect(transforms).toHaveLength(2);
    expect(feedback).toBe('rename it pnl_v2');
    await waitFor(() => expect(screen.getByLabelText('Preview of pnl_v2')).toBeTruthy());
  });
});
