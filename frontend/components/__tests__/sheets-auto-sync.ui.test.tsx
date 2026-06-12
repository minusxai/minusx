/** SheetsAutoSyncSection + its wiring into StaticConnectionConfig (jsdom). */

import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SheetsAutoSyncSection } from '@/components/views/connection-configs/SheetsAutoSyncSection';
import StaticConnectionConfig from '@/components/views/connection-configs/StaticConnectionConfig';
import type { CsvFileInfo } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

describe('SheetsAutoSyncSection', () => {
  it('renders toggle off and hides the schedule when autoSync is unset', () => {
    const { getByLabelText, queryByLabelText } = renderWithProviders(
      <SheetsAutoSyncSection autoSync={undefined} onChange={vi.fn()} />
    );
    const toggle = getByLabelText('Toggle auto-sync') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(queryByLabelText('Cron expression')).toBeNull();
  });

  it('enabling the toggle emits the default every-3-hours schedule', async () => {
    const onChange = vi.fn();
    const { getByLabelText } = renderWithProviders(
      <SheetsAutoSyncSection autoSync={undefined} onChange={onChange} />
    );
    fireEvent.click(getByLabelText('Toggle auto-sync'));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({ cron: '0 */3 * * *', timezone: 'UTC' });
    });
  });

  it('shows the schedule when autoSync is set and disabling emits undefined', async () => {
    const onChange = vi.fn();
    const { getByLabelText } = renderWithProviders(
      <SheetsAutoSyncSection autoSync={{ cron: '0 */6 * * *', timezone: 'UTC' }} onChange={onChange} />
    );
    const toggle = getByLabelText('Toggle auto-sync') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect((getByLabelText('Cron expression') as HTMLInputElement).value).toBe('0 */6 * * *');

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(undefined);
    });
  });

  it('editing the cron expression emits the updated schedule', async () => {
    const onChange = vi.fn();
    const { getByLabelText } = renderWithProviders(
      <SheetsAutoSyncSection autoSync={{ cron: '0 */3 * * *', timezone: 'UTC' }} onChange={onChange} />
    );
    fireEvent.change(getByLabelText('Cron expression'), { target: { value: '0 * * * *' } });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({ cron: '0 * * * *', timezone: 'UTC' });
    });
  });

  it('shows last synced time when provided', () => {
    const { getByLabelText } = renderWithProviders(
      <SheetsAutoSyncSection
        autoSync={{ cron: '0 */3 * * *', timezone: 'UTC' }}
        onChange={vi.fn()}
        lastSyncedAt="2026-06-12T03:00:00.000Z"
      />
    );
    expect(getByLabelText('Last synced').textContent).toContain('2026');
  });

  it('shows the last sync error when provided', () => {
    const { getByLabelText } = renderWithProviders(
      <SheetsAutoSyncSection
        autoSync={{ cron: '0 */3 * * *', timezone: 'UTC' }}
        onChange={vi.fn()}
        lastSyncedAt="2026-06-12T03:00:00.000Z"
        lastSyncError="https://docs.google.com/spreadsheets/d/SS2/edit: Spreadsheet is not publicly accessible"
      />
    );
    expect(getByLabelText('Last sync error').textContent).toContain('not publicly accessible');
  });

  it('disables controls when editMode is false', () => {
    const { getByLabelText } = renderWithProviders(
      <SheetsAutoSyncSection
        autoSync={{ cron: '0 */3 * * *', timezone: 'UTC' }}
        onChange={vi.fn()}
        editMode={false}
      />
    );
    expect((getByLabelText('Toggle auto-sync') as HTMLInputElement).disabled).toBe(true);
    expect((getByLabelText('Cron expression') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('StaticConnectionConfig auto-sync wiring', () => {
  const sheetFile: CsvFileInfo = {
    filename: 'Orders.csv',
    table_name: 'orders',
    schema_name: 'gs',
    s3_key: 'k1',
    file_format: 'parquet',
    row_count: 1,
    columns: [{ name: 'a', type: 'VARCHAR' }],
    source_type: 'google_sheets',
    spreadsheet_url: 'https://docs.google.com/spreadsheets/d/SS1/edit',
    spreadsheet_id: 'SS1',
  };
  const csvFile: CsvFileInfo = {
    filename: 'upload.csv',
    table_name: 'upload',
    schema_name: 'public',
    s3_key: 'k2',
    file_format: 'parquet',
    row_count: 1,
    columns: [{ name: 'x', type: 'BIGINT' }],
    source_type: 'csv',
  };

  function renderStatic(files: CsvFileInfo[], onAutoSyncChange = vi.fn()) {
    return renderWithProviders(
      <StaticConnectionConfig
        config={{ files }}
        onChange={vi.fn()}
        mode="view"
        userMode="org"
        onError={vi.fn()}
        autoSync={undefined}
        onAutoSyncChange={onAutoSyncChange}
      />
    );
  }

  it('shows the auto-sync section when the connection has Google Sheets files', () => {
    const { getByLabelText } = renderStatic([csvFile, sheetFile]);
    expect(getByLabelText('Toggle auto-sync')).toBeTruthy();
  });

  it('hides the auto-sync section when there are no Google Sheets files', () => {
    const { queryByLabelText } = renderStatic([csvFile]);
    expect(queryByLabelText('Toggle auto-sync')).toBeNull();
  });

  it('forwards toggle changes to onAutoSyncChange', async () => {
    const onAutoSyncChange = vi.fn();
    const { getByLabelText } = renderStatic([sheetFile], onAutoSyncChange);
    fireEvent.click(getByLabelText('Toggle auto-sync'));
    await waitFor(() => {
      expect(onAutoSyncChange).toHaveBeenCalledWith({ cron: '0 */3 * * *', timezone: 'UTC' });
    });
  });
});
