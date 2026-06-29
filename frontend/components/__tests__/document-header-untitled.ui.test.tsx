// DocumentHeader — view-mode heading must never render blank: an untitled file falls back to
// "Untitled <Type>" so a nameless file is still recognizable (consistent with list views).
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import DocumentHeader, { type DocumentHeaderProps } from '@/components/DocumentHeader';

function baseProps(overrides: Partial<DocumentHeaderProps> = {}): DocumentHeaderProps {
  return {
    name: '',
    description: '',
    fileType: 'question',
    editMode: false,
    isDirty: false,
    isSaving: false,
    onNameChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onEditModeToggle: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

describe('DocumentHeader untitled fallback (view mode)', () => {
  it('shows "Untitled <Type>" when the name is empty', () => {
    const { getByLabelText } = renderWithProviders(
      <DocumentHeader {...baseProps({ name: '', fileType: 'dashboard' })} />,
    );
    expect(getByLabelText('Untitled Dashboard')).toBeInTheDocument();
  });

  it('shows the real title when present', () => {
    const { getByLabelText } = renderWithProviders(
      <DocumentHeader {...baseProps({ name: 'Revenue Overview', fileType: 'dashboard' })} />,
    );
    expect(getByLabelText('Revenue Overview')).toBeInTheDocument();
  });
});
