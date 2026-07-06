// ContextDocsEditor — "Auto" generate buttons for empty per-doc title/description.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

vi.mock('@/components/lexical/LexicalTextEditor', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement('div', { 'data-testid': 'lexical-editor' }),
    LexicalTextViewer: () => React.createElement('div'),
  };
});
vi.mock('@monaco-editor/react', () => ({ DiffEditor: () => null }));
vi.mock('@/lib/object-store/client', () => ({ uploadFile: vi.fn() }));
vi.mock('@/lib/tools/micro-task', () => ({ runMicroTaskClient: vi.fn(async () => 'Generated Value') }));

import ContextDocsEditor from '@/components/context/ContextDocsEditor';
import { runMicroTaskClient } from '@/lib/tools/micro-task';
import type { DocEntry } from '@/lib/types';

describe('ContextDocsEditor generate buttons', () => {
  it('generates a title from the doc body and commits it', async () => {
    const docs: DocEntry[] = [{ content: 'Revenue by region, monthly.', draft: true }];
    const onDocsChange = vi.fn();
    const { findByLabelText } = renderWithProviders(
      <ContextDocsEditor docs={docs} onDocsChange={onDocsChange} />,
    );

    const titleBtn = await findByLabelText('Generate title for entry 1');
    fireEvent.click(titleBtn);

    await waitFor(() =>
      expect(runMicroTaskClient).toHaveBeenCalledWith(
        'title',
        expect.objectContaining({
          input: 'Revenue by region, monthly.',
          subject: 'a knowledge base document',
          instructions: expect.stringContaining('analytics agent'),
        }),
      ),
    );
    await waitFor(() => expect(onDocsChange).toHaveBeenCalled());
    const lastDocs = onDocsChange.mock.calls.at(-1)![0] as DocEntry[];
    expect(lastDocs[0].title).toBe('Generated Value');
  });

  it('hides the title button when a title already exists', () => {
    const docs: DocEntry[] = [{ content: 'Body', title: 'Has title', draft: true }];
    const { queryByLabelText } = renderWithProviders(
      <ContextDocsEditor docs={docs} onDocsChange={vi.fn()} />,
    );
    expect(queryByLabelText('Generate title for entry 1')).toBeNull();
  });

  it('hides both buttons when the doc body is empty (nothing to summarize)', () => {
    const docs: DocEntry[] = [{ content: '', draft: true }];
    const { queryByLabelText } = renderWithProviders(
      <ContextDocsEditor docs={docs} onDocsChange={vi.fn()} />,
    );
    expect(queryByLabelText('Generate title for entry 1')).toBeNull();
    expect(queryByLabelText('Generate description for entry 1')).toBeNull();
  });
});
