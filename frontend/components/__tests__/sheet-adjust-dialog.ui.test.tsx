/**
 * SheetAdjustDialog — "Adjust with agent" on an already-imported spreadsheet group.
 * Opening it prepares (live grids + previews of the STORED transforms, no LLM), then the
 * user can revise with feedback and Apply — which replaces the group's tables in the
 * connection config and queues the old blobs for deletion on save. Cancel discards the
 * transient raw grids. Client API is mocked; the real SheetImportReview renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SheetAdjustDialog from '@/components/views/connection-configs/SheetAdjustDialog';
import type { CsvFileInfo } from '@/lib/types';

const { api } = vi.hoisted(() => ({
  api: {
    prepareGoogleSheetAdjustment: vi.fn(),
    reviseGoogleSheetTransforms: vi.fn(),
    confirmGoogleSheetImport: vi.fn(),
    discardGoogleSheetRawGrids: vi.fn(),
  },
}));
vi.mock('@/lib/connections/client/google-sheets', () => api);

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/ADJ1/edit';

const transform = (name: string) => ({
  output_table: name,
  schema_name: 'finance',
  source_tables: ['l1_consol'],
  sql: `SELECT B FROM raw.l1_consol -- ${name}`,
  description: `Cleans ${name}.`,
});
const preview = {
  columns: [{ name: 'line_item', type: 'VARCHAR' }],
  rows: [{ line_item: 'Revenue' }],
  row_count: 45,
};

const groupFile = (name: string, s3_key: string): CsvFileInfo => ({
  filename: `${name}.parquet`, table_name: name, schema_name: 'finance', s3_key,
  file_format: 'parquet', row_count: 45, columns: [],
  source_type: 'google_sheets', spreadsheet_url: SHEET_URL, spreadsheet_id: 'ADJ1',
  transform: transform(name),
});

const otherFile: CsvFileInfo = {
  filename: 'other.csv', table_name: 'other', schema_name: 'public', s3_key: 'other-key',
  file_format: 'csv', row_count: 3, columns: [],
};

const prepared = {
  spreadsheet_id: 'ADJ1',
  raw_files: [{ tab_name: 'L1', table_name: 'l1_consol', s3_key: 'csvs/org/static/raw/g9.parquet', n_rows: 20, n_cols: 6 }],
  transforms: [transform('pnl_long'), transform('margins')],
  previews: { pnl_long: preview, margins: preview },
  dropped: [],
};

function setup() {
  const group = [groupFile('pnl_long', 'old-pnl-key'), groupFile('margins', 'old-margins-key')];
  const props = {
    open: true,
    connectionName: 'static',
    groupFiles: group,
    existingFiles: [...group, otherFile],
    onChange: vi.fn(),
    onError: vi.fn(),
    onPendingDeletion: vi.fn(),
    onClose: vi.fn(),
  };
  renderWithProviders(<SheetAdjustDialog {...props} />);
  return props;
}

describe('SheetAdjustDialog', () => {
  beforeEach(() => {
    Object.values(api).forEach((m) => m.mockReset());
    api.prepareGoogleSheetAdjustment.mockResolvedValue({ success: true, message: 'ok', data: prepared });
    api.discardGoogleSheetRawGrids.mockResolvedValue({ success: true, message: 'ok', data: {} });
  });

  it('prepares on open: previews the STORED transforms against the live sheet, no LLM', async () => {
    setup();
    await waitFor(() => expect(screen.getByLabelText('Preview of pnl_long')).toBeTruthy());
    const [conn, url, transforms] = api.prepareGoogleSheetAdjustment.mock.calls[0];
    expect(conn).toBe('static');
    expect(url).toBe(SHEET_URL);
    expect(transforms.map((t: { output_table: string }) => t.output_table)).toEqual(['pnl_long', 'margins']);
    expect(api.reviseGoogleSheetTransforms).not.toHaveBeenCalled();
  });

  it('revising sends feedback with the current transforms over the fresh raw grids', async () => {
    // The LLM often omits schema_name (normalizer defaults it to 'public') — the dialog must
    // pin revised transforms back to the group's ORIGINAL schema, never silently move tables.
    api.reviseGoogleSheetTransforms.mockResolvedValue({
      success: true, message: 'ok',
      data: { transforms: [{ ...transform('pnl_v2'), schema_name: 'public' }], previews: { pnl_v2: preview }, dropped: [] },
    });
    setup();
    await waitFor(() => expect(screen.getByLabelText('Preview of pnl_long')).toBeTruthy());

    await userEvent.type(screen.getByLabelText('Feedback for the agent'), 'merge margins into pnl');
    await userEvent.click(screen.getByLabelText('Revise with agent'));

    await waitFor(() => expect(api.reviseGoogleSheetTransforms).toHaveBeenCalled());
    const [conn, rawFiles, transforms, feedback] = api.reviseGoogleSheetTransforms.mock.calls[0];
    expect(conn).toBe('static');
    expect(rawFiles).toEqual(prepared.raw_files);
    expect(transforms).toHaveLength(2);
    expect(feedback).toBe('merge margins into pnl');
    await waitFor(() => expect(screen.getByLabelText('Preview of pnl_v2')).toBeTruthy());
    // Revised proposal keeps the group's original schema despite the LLM's 'public' default.
    expect(screen.getByText('finance.pnl_v2')).toBeTruthy();
  });

  it('applying replaces the group files in place and queues the old blobs for deletion on save', async () => {
    const newFiles = [{ ...groupFile('pnl_long', 'new-pnl-key'), row_count: 50 }];
    api.confirmGoogleSheetImport.mockResolvedValue({
      success: true, message: 'ok', data: { files: newFiles, spreadsheet_url: SHEET_URL, spreadsheet_id: 'ADJ1' },
    });
    const props = setup();
    await waitFor(() => expect(screen.getByLabelText('Preview of pnl_long')).toBeTruthy());

    await userEvent.click(screen.getByLabelText('Include table margins')); // exclude one
    await userEvent.click(screen.getByLabelText('Apply 1 tables'));

    await waitFor(() => expect(api.confirmGoogleSheetImport).toHaveBeenCalled());
    const [conn, url, rawFiles, transforms] = api.confirmGoogleSheetImport.mock.calls[0];
    expect(conn).toBe('static');
    expect(url).toBe(SHEET_URL);
    expect(rawFiles).toEqual(prepared.raw_files);
    expect(transforms.map((t: { output_table: string }) => t.output_table)).toEqual(['pnl_long']);

    // Group replaced in place, unrelated files preserved; old blobs queued for save-time deletion.
    await waitFor(() => expect(props.onChange).toHaveBeenCalledWith({ files: [...newFiles, otherFile] }));
    expect(props.onPendingDeletion).toHaveBeenCalledWith('old-pnl-key');
    expect(props.onPendingDeletion).toHaveBeenCalledWith('old-margins-key');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('cancel discards the transient raw grids and closes without touching the connection', async () => {
    const props = setup();
    await waitFor(() => expect(screen.getByLabelText('Preview of pnl_long')).toBeTruthy());

    await userEvent.click(screen.getByLabelText('Cancel import review'));

    await waitFor(() => expect(api.discardGoogleSheetRawGrids).toHaveBeenCalledWith('static', prepared.raw_files));
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });
});
