// DocumentHeader — "generate with AI" buttons for empty title/description.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import DocumentHeader, { type DocumentHeaderProps } from '@/components/DocumentHeader';

function baseProps(overrides: Partial<DocumentHeaderProps> = {}): DocumentHeaderProps {
  return {
    name: '',
    description: '',
    fileType: 'question',
    editMode: true,
    isDirty: false,
    isSaving: false,
    onNameChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onEditModeToggle: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

describe('DocumentHeader generate buttons', () => {
  it('shows generate buttons for empty fields in edit mode and fires the handlers', async () => {
    const onGenerateName = vi.fn();
    const onGenerateDescription = vi.fn();
    const { findByLabelText } = renderWithProviders(
      <DocumentHeader {...baseProps({ onGenerateName, onGenerateDescription })} />,
    );

    const nameBtn = await findByLabelText('Generate Question name');
    const descBtn = await findByLabelText('Generate description');

    fireEvent.click(nameBtn);
    fireEvent.click(descBtn);
    expect(onGenerateName).toHaveBeenCalledTimes(1);
    expect(onGenerateDescription).toHaveBeenCalledTimes(1);
  });

  it('hides the name generate button when a title already exists', () => {
    const { queryByLabelText } = renderWithProviders(
      <DocumentHeader {...baseProps({ name: 'Existing title', onGenerateName: vi.fn() })} />,
    );
    expect(queryByLabelText('Generate Question name')).toBeNull();
  });

  it('hides the description generate button when a description already exists', () => {
    const { queryByLabelText } = renderWithProviders(
      <DocumentHeader {...baseProps({ description: 'Existing description', onGenerateDescription: vi.fn() })} />,
    );
    expect(queryByLabelText('Generate description')).toBeNull();
  });

  it('does not show generate buttons outside edit mode', () => {
    const { queryByLabelText } = renderWithProviders(
      <DocumentHeader {...baseProps({ editMode: false, onGenerateName: vi.fn(), onGenerateDescription: vi.fn() })} />,
    );
    expect(queryByLabelText('Generate Question name')).toBeNull();
    expect(queryByLabelText('Generate description')).toBeNull();
  });

  it('does not show generate buttons when no handler is provided', () => {
    const { queryByLabelText } = renderWithProviders(<DocumentHeader {...baseProps()} />);
    expect(queryByLabelText('Generate Question name')).toBeNull();
    expect(queryByLabelText('Generate description')).toBeNull();
  });
});
