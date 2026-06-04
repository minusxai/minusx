/**
 * ContextDocsEditor — the reusable multi-doc collapsible list shared by the
 * context file editor and the onboarding wizard. Verifies the core controlled
 * behaviors: render one card per entry, add, remove, and (debounced) edit.
 *
 * Per repo convention these queries use aria-labels only.
 */

import { useState } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { DocEntry } from '@/lib/types';
import ContextDocsEditor from '@/components/context/ContextDocsEditor';

function Harness({ initial, onChange }: { initial: DocEntry[]; onChange?: (d: DocEntry[]) => void }) {
  const [docs, setDocs] = useState<DocEntry[]>(initial);
  return (
    <ContextDocsEditor
      docs={docs}
      onDocsChange={(d) => { onChange?.(d); setDocs(d); }}
      showChildPaths={false}
      showDraftToggle={false}
    />
  );
}

describe('ContextDocsEditor', () => {
  it('renders one removable card per doc entry', async () => {
    renderWithProviders(<Harness initial={[{ content: 'Alpha' }, { content: 'Beta' }]} />);
    expect(await screen.findByLabelText('Remove Documentation Entry 1')).toBeInTheDocument();
    expect(await screen.findByLabelText('Remove Documentation Entry 2')).toBeInTheDocument();
  });

  it('adds a new empty entry when the add button is clicked', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={[{ content: 'Alpha' }]} onChange={onChange} />);

    await userEvent.click(await screen.findByLabelText('Add Documentation Entry'));

    expect(onChange).toHaveBeenCalledWith([{ content: 'Alpha' }, { content: '' }]);
    // The new card is now present.
    expect(await screen.findByLabelText('Remove Documentation Entry 2')).toBeInTheDocument();
  });

  it('removes an entry when its remove button is clicked', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={[{ content: 'Alpha' }, { content: 'Beta' }]} onChange={onChange} />);

    await userEvent.click(await screen.findByLabelText('Remove Documentation Entry 1'));

    expect(onChange).toHaveBeenCalledWith([{ content: 'Beta' }]);
  });

  it('honors controlled expandedIndices via onExpandedChange', async () => {
    const onExpandedChange = vi.fn();
    // Controlled with nothing expanded; toggling entry 2 should request [1].
    renderWithProviders(
      <ContextDocsEditor
        docs={[{ content: 'Alpha' }, { content: 'Beta' }]}
        onDocsChange={() => {}}
        expandedIndices={[]}
        onExpandedChange={onExpandedChange}
        showChildPaths={false}
        showDraftToggle={false}
      />,
    );

    await userEvent.click(await screen.findByLabelText('Toggle Documentation Entry 2'));
    expect(onExpandedChange).toHaveBeenCalledWith([1]);
  });

  it('debounces markdown edits into onDocsChange', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={[{ content: 'Alpha' }]} onChange={onChange} />);

    // First entry is expanded by default → its editor (mocked textarea) is mounted.
    const editor = (await screen.findAllByLabelText('SQL editor'))[0];
    fireEvent.change(editor, { target: { value: 'Alpha edited' } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([{ content: 'Alpha edited' }]);
    }, { timeout: 1000 });
  });

  it('commits a title edit on blur', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={[{ content: 'Alpha' }]} onChange={onChange} />);

    const titleInput = await screen.findByLabelText('Documentation Entry 1 title');
    await userEvent.type(titleInput, 'Metrics');
    fireEvent.blur(titleInput);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([{ content: 'Alpha', title: 'Metrics' }]);
    });
  });

  it('commits a description edit on blur', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={[{ content: 'Alpha' }]} onChange={onChange} />);

    const descInput = await screen.findByLabelText('Documentation Entry 1 description');
    await userEvent.type(descInput, 'Key revenue metrics');
    fireEvent.blur(descInput);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([{ content: 'Alpha', description: 'Key revenue metrics' }]);
    });
  });

  it('clears the title to undefined when emptied', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={[{ content: 'Alpha', title: 'Old' }]} onChange={onChange} />);

    const titleInput = await screen.findByLabelText('Documentation Entry 1 title');
    await userEvent.clear(titleInput);
    fireEvent.blur(titleInput);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([{ content: 'Alpha', title: undefined }]);
    });
  });

  it('seeds the title input from the existing entry', async () => {
    renderWithProviders(<Harness initial={[{ content: 'Alpha', title: 'Seeded' }]} />);
    const titleInput = await screen.findByLabelText('Documentation Entry 1 title') as HTMLInputElement;
    expect(titleInput.value).toBe('Seeded');
  });

  it('hides the title/description inputs when showTitleDescription is false', async () => {
    renderWithProviders(
      <ContextDocsEditor
        docs={[{ content: 'Alpha' }]}
        onDocsChange={() => {}}
        showTitleDescription={false}
        showChildPaths={false}
        showDraftToggle={false}
      />,
    );
    // The entry card renders, but no title input.
    expect(await screen.findByLabelText('Remove Documentation Entry 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Documentation Entry 1 title')).not.toBeInTheDocument();
  });
});
