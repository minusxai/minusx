/**
 * Regression: the Dataset Name field was painted as an error before the user had touched it.
 *
 * Its red border, red asterisk and the warning "Enter a dataset name above to enable upload."
 * were all driven by `!pendingFiles[0]?.schemaName` alone, which is true the instant a file is
 * staged — so the very first frame of the upload step accused the user of getting wrong a field
 * they had not yet been given a chance to fill. On a first-run setup screen that reads as "you
 * broke something", not "one more step".
 *
 * The field is still required and Upload is still disabled without it. Only the error PRESENTATION
 * waits: it appears once the user has left the field, or tried to upload without it.
 */

vi.mock('@/lib/connections/client/csv-upload', () => ({
  uploadCsvFilesS3: vi.fn(async () => ({ files: [] })),
}));

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStore } from '@/store/store';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { CsvUploadPanel } from '@/components/views/connection-configs/CsvUploadPanel';

function render() {
  return renderWithProviders(
    <CsvUploadPanel
      isActive
      existingFiles={[]}
      collisionSet={new Set()}
      onChange={vi.fn()}
      onError={vi.fn()}
      uploadProgress="idle"
      setUploadProgress={vi.fn()}
      setActivePanel={vi.fn()}
      setTablesOpen={vi.fn()}
      setCollapsedSchemas={vi.fn()}
    />,
    { store: makeStore() }
  );
}

async function stageAFile() {
  const input = screen.getByLabelText('CSV file input') as HTMLInputElement;
  const file = new File(['a,b\n1,2\n'], 'sales_orders.csv', { type: 'text/csv' });
  await userEvent.upload(input, file);
  return screen.findByLabelText('CSV dataset name');
}

describe('CsvUploadPanel — Dataset Name error timing', () => {
  it('does not show the error before the user has touched the field', async () => {
    render();
    await stageAFile();

    expect(screen.queryByText(/Enter a dataset name above/i)).not.toBeInTheDocument();
  });

  it('shows the error once the user leaves the field empty', async () => {
    const user = userEvent.setup();
    render();
    const input = await stageAFile();

    await user.click(input);
    await user.tab();

    await waitFor(() => expect(screen.getByText(/Enter a dataset name above/i)).toBeInTheDocument());
  });

  it('clears the error as soon as a name is typed', async () => {
    const user = userEvent.setup();
    render();
    const input = await stageAFile();

    await user.click(input);
    await user.tab();
    await waitFor(() => expect(screen.getByText(/Enter a dataset name above/i)).toBeInTheDocument());

    await user.type(input, 'sales_orders_2026');

    await waitFor(() => expect(screen.queryByText(/Enter a dataset name above/i)).not.toBeInTheDocument());
  });

  it('still blocks Upload while the name is empty, touched or not', async () => {
    render();
    await stageAFile();

    expect(screen.getByLabelText('Upload files')).toBeDisabled();
  });
});
