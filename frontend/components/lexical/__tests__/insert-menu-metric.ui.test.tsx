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
  it('shows a saved metric definition and its SQL in the document', async () => {
    renderWithProviders(
      <LexicalTextEditor
        initialMarkdown={':::metric{name="Monthly Revenue" description="Revenue recognized in each calendar month"}\nSELECT sum(amount) AS revenue\nFROM invoices\n:::'}
        onChange={() => {}}
        insertMetric
      />,
    );

    const metric = await screen.findByLabelText('Metric Monthly Revenue');
    expect(metric).toHaveTextContent('Monthly Revenue');
    expect(metric).toHaveTextContent('Revenue recognized in each calendar month');
    expect(metric).toHaveTextContent('SQL');
    expect(metric).toHaveTextContent('SELECT sum(amount) AS revenue');

    await userEvent.click(metric);
    expect(await screen.findByLabelText('Metric name')).toHaveValue('Monthly Revenue');
  });

  it('does not render an empty SQL section when a metric has no SQL', async () => {
    renderWithProviders(
      <LexicalTextEditor
        initialMarkdown={':::metric{name="Active Users" description="Unique users active in the selected period"}\n:::'}
        onChange={() => {}}
        insertMetric
      />,
    );

    const metric = await screen.findByLabelText('Metric Active Users');
    expect(metric).toHaveTextContent('Unique users active in the selected period');
    expect(metric).not.toHaveTextContent('SQL');
  });

  it('offers Metric in the + insert menu when insertMetric is set, and inserts a definition block', async () => {
    const getEditor = mountEditor({ insertMetric: true });
    await waitFor(() => expect(getEditor()).toBeTruthy());

    typePlusTrigger(getEditor());

    const option = await screen.findByLabelText('Insert Metric');
    await userEvent.click(option);

    // The inserted (unnamed) metric renders as a definition block…
    expect(await screen.findByLabelText('Metric untitled')).toBeInTheDocument();
    // …with its editor open and the Name field focused — typing must land in
    // the popover, not leak into the document (Lexical grabs focus after
    // $insertNodes unless the editor explicitly hands it to the input).
    await waitFor(() => expect(screen.getByLabelText('Metric name')).toHaveFocus());
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
