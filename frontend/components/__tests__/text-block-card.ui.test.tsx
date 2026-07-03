/**
 * TextBlockCard — the dashboard rich-text block. It now uses the same Lexical
 * WYSIWYG editor (and read-only viewer) as notebook text cells and context docs,
 * instead of Monaco + react-markdown. These tests assert the controlled wiring:
 * view mode renders the Lexical viewer; edit mode renders the Lexical editor and
 * edits flow up through onContentChange.
 *
 * Lexical can't be meaningfully driven in jsdom (real markdown round-trip is
 * covered by the headless transformer tests), so we mock it with a textarea /
 * div, exactly like the context-docs editor test.
 *
 * Per repo convention these queries use aria-labels only.
 */

vi.mock('@/components/lexical/LexicalTextEditor', () => {
  const React = require('react');
  return {
    __esModule: true,
    SHARED_TEXT_PADDING: '44px 26px 26px',
    default: ({ initialMarkdown, onChange, renderToolbar }: { initialMarkdown: string; onChange: (md: string) => void; renderToolbar?: (t: React.ReactNode) => React.ReactNode }) => {
      const textarea = React.createElement('textarea', {
        'aria-label': 'Text block editor',
        defaultValue: initialMarkdown,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
      });
      // Mirror the real editor: host the chrome passed via renderToolbar so the
      // dashboard's remove button (which lives in that slot) is present.
      return React.createElement('div', null, renderToolbar ? renderToolbar(null) : null, textarea);
    },
    LexicalTextViewer: ({ markdown }: { markdown: string }) =>
      React.createElement('div', { 'aria-label': 'Text block preview' }, markdown),
  };
});

// The schema context hook hits the store/network; stub it so the test stays a
// pure component-wiring check.
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ databases: [] }),
}));

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import TextBlockCard from '@/components/TextBlockCard';

describe('TextBlockCard', () => {
  it('renders content through the Lexical viewer in view mode', async () => {
    renderWithProviders(
      <TextBlockCard id="t1" content="# Hello" editMode={false} onContentChange={() => {}} onRemove={() => {}} />,
    );
    const preview = await screen.findByLabelText('Text block preview');
    expect(preview).toHaveTextContent('# Hello');
  });

  it('shows an empty-state hint when there is no content', async () => {
    renderWithProviders(
      <TextBlockCard id="t1" content="" editMode={false} onContentChange={() => {}} onRemove={() => {}} />,
    );
    expect(await screen.findByLabelText('Empty text block')).toBeInTheDocument();
  });

  it('seeds the Lexical editor with content in edit mode', async () => {
    renderWithProviders(
      <TextBlockCard id="t1" content="seed text" editMode onContentChange={() => {}} onRemove={() => {}} />,
    );
    const editor = (await screen.findByLabelText('Text block editor')) as HTMLTextAreaElement;
    expect(editor.value).toBe('seed text');
  });

  it('flows edits up through onContentChange in edit mode', async () => {
    const onContentChange = vi.fn();
    renderWithProviders(
      <TextBlockCard id="t1" content="seed" editMode onContentChange={onContentChange} onRemove={() => {}} />,
    );
    const editor = await screen.findByLabelText('Text block editor');
    fireEvent.change(editor, { target: { value: 'edited' } });

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalledWith('t1', 'edited');
    }, { timeout: 1000 });
  });

  it('removes the block when the remove button is clicked', async () => {
    const onRemove = vi.fn();
    renderWithProviders(
      <TextBlockCard id="t1" content="x" editMode onContentChange={() => {}} onRemove={onRemove} />,
    );
    fireEvent.click(await screen.findByLabelText('Remove text block'));
    expect(onRemove).toHaveBeenCalledWith('t1');
  });
});
