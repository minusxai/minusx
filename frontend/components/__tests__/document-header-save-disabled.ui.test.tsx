// DocumentHeader — Save stays enabled; clicking surfaces a validation reason
// (validateBeforeSave) instead of silently doing nothing.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import DocumentHeader, { type DocumentHeaderProps } from '@/components/file-browser/DocumentHeader';

function baseProps(overrides: Partial<DocumentHeaderProps> = {}): DocumentHeaderProps {
  return {
    name: 'Has a title',
    description: 'Has a description',
    fileType: 'context',
    editMode: true,
    isDirty: true,
    isSaving: false,
    onNameChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onEditModeToggle: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

const REASON = 'Every active document needs a title and description.';

describe('DocumentHeader validateBeforeSave', () => {
  it('blocks save and shows the reason when validation fails on click', async () => {
    const onSave = vi.fn();
    const { findByLabelText } = renderWithProviders(
      <DocumentHeader {...baseProps({ onSave, validateBeforeSave: () => REASON })} />,
    );

    fireEvent.click(await findByLabelText('Save'));

    expect(onSave).not.toHaveBeenCalled();
    expect(await findByLabelText(REASON)).toBeTruthy();
  });

  it('saves when validation passes', async () => {
    const onSave = vi.fn();
    const { findByLabelText } = renderWithProviders(
      <DocumentHeader {...baseProps({ onSave, validateBeforeSave: () => null })} />,
    );

    fireEvent.click(await findByLabelText('Save'));

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('clears the validation banner when Cancel is clicked', async () => {
    const { findByLabelText, queryByLabelText } = renderWithProviders(
      <DocumentHeader {...baseProps({ validateBeforeSave: () => REASON })} />,
    );

    fireEvent.click(await findByLabelText('Save'));
    expect(await findByLabelText(REASON)).toBeTruthy();

    fireEvent.click(await findByLabelText('Cancel editing'));
    expect(queryByLabelText(REASON)).toBeNull();
  });
});
