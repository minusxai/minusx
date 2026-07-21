/**
 * LexicalTextEditor `insertMetric` — the "+" insert menu offers a Metric
 * option (chip with inline name/description/SQL editor) only when the caller
 * opts in. Context docs opt in; dashboard text blocks and notebook cells don't.
 *
 * The editor is mounted for real; instead of typing (which jsdom can't drive
 * through contenteditable), the "+" trigger is created programmatically via
 * the editor handed back by onEditorReady.
 */

import { act } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from 'lexical';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import LexicalTextEditor from '@/components/lexical/LexicalTextEditor';

function mountEditor(props: { insertMetric?: boolean }) {
  let editor: LexicalEditor | null = null;
  renderWithProviders(
    <LexicalTextEditor
      initialMarkdown=""
      onChange={() => {}}
      insertMenu
      insertMetric={props.insertMetric}
      onEditorReady={(e) => { editor = e; }}
    />,
  );
  return () => editor!;
}

/** Type the "+" trigger programmatically: a paragraph containing "+", caret after it. */
function typePlusTrigger(editor: LexicalEditor) {
  act(() => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const text = $createTextNode('+');
      paragraph.append(text);
      root.append(paragraph);
      text.select(1, 1);
    });
  });
}

beforeEach(() => {
  // jsdom's Range has no getBoundingClientRect; the insert menu uses it to
  // position the dropdown at the caret.
  Range.prototype.getBoundingClientRect = () =>
    ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
});

describe('LexicalTextEditor insertMetric', () => {
  it('offers Metric in the + insert menu when insertMetric is set, and inserts a chip', async () => {
    const getEditor = mountEditor({ insertMetric: true });
    await waitFor(() => expect(getEditor()).toBeTruthy());

    typePlusTrigger(getEditor());

    const option = await screen.findByLabelText('Insert Metric');
    await userEvent.click(option);

    // The inserted (unnamed) metric renders as a chip.
    expect(await screen.findByLabelText('Metric untitled')).toBeInTheDocument();
  });

  it('does not offer Metric without the opt-in', async () => {
    const getEditor = mountEditor({});
    await waitFor(() => expect(getEditor()).toBeTruthy());

    typePlusTrigger(getEditor());

    await waitFor(() => {
      expect(screen.queryByLabelText('Insert Metric')).not.toBeInTheDocument();
    });
  });
});
