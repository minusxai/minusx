/**
 * CreateQuestionModalContainer — story-embed editing modes.
 *
 * A story opens this modal for its question embeds in one of two modes:
 * - 'saved-override' (a `<Question id viz>` embed): viz edits are CAPTURED as a story-level
 *   override (handed back via onApplyVizOverride on Update) and never staged on the saved file;
 *   all other edits stage on the file exactly like the dashboard flow.
 * - 'ephemeral' (an inline `<Question query|spreadsheet>` embed): the modal edits a throwaway
 *   draft file; Update hands the edited content back via onEphemeralApply and deletes the draft.
 * A `sourceBadge` chip makes the saved/ephemeral distinction visible in the header.
 * QuestionViewV2 is mocked — the routing logic is under test, not the editor UI.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import type { QuestionContent, DbFile } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const h = vi.hoisted(() => ({
  viewProps: [] as Record<string, unknown>[],
  edits: [] as Record<string, unknown>[],
  deleted: [] as number[],
  NEXT_ENVELOPE: {
    version: 2,
    source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: '.mx-th{color:red}' },
  },
}));

vi.mock('@/components/views/QuestionViewV2', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    h.viewProps.push(props);
    return React.createElement('button', {
      'aria-label': 'Trigger viz change',
      onClick: () => (props.onChange as (u: unknown) => void)({ viz: h.NEXT_ENVELOPE }),
    });
  };
  return { __esModule: true, default: Fake };
});

vi.mock('@/lib/file-state/file-state', async (importOriginal) => {
  const orig = await importOriginal<object>();
  return {
    ...orig,
    editFile: vi.fn((args: Record<string, unknown>) => { h.edits.push(args); return { success: true }; }),
    deleteFile: vi.fn((args: { fileId: number }) => { h.deleted.push(args.fileId); return Promise.resolve(); }),
  };
});

import CreateQuestionModalContainer from '@/components/modals/CreateQuestionModalContainer';

const FILE_ID = 4242;

const SAVED_ENVELOPE: VizEnvelope = {
  version: 2,
  source: { kind: 'recipe', recipe: 'minusx/funnel@1', bindings: {}, params: null, columnFormats: null },
};
const OVERRIDE: VizEnvelope = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: '.mx-th{background:#111}' },
};

function makeQuestion(content: Partial<QuestionContent> = {}): DbFile {
  return {
    id: FILE_ID,
    name: 'Revenue by month',
    type: 'question',
    path: '/org/Revenue-by-month',
    content: {
      description: null,
      query: '',
      vizSettings: { type: 'table' },
      parameters: [],
      parameterValues: {},
      connection_name: '',
      ...content,
    } as QuestionContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function setup(file: DbFile, props: Record<string, unknown>) {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file, references: [] }));
  return renderWithProviders(
    <CreateQuestionModalContainer
      isOpen
      onClose={vi.fn()}
      onQuestionCreated={vi.fn()}
      folderPath="/org"
      questionId={FILE_ID}
      isNewQuestion={false}
      {...props}
    />,
    { store: testStore },
  );
}

beforeEach(() => {
  h.viewProps.length = 0;
  h.edits.length = 0;
  h.deleted.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('story-embed modal — saved-override mode', () => {
  it('shows the Saved question badge and renders the override applied over the file viz', async () => {
    setup(makeQuestion({ viz: SAVED_ENVELOPE }), {
      storyEmbedMode: 'saved-override',
      vizOverride: OVERRIDE,
      onApplyVizOverride: vi.fn(),
      sourceBadge: 'saved',
    });
    expect((await screen.findByLabelText('Story embed type')).textContent).toContain('Saved question');
    await waitFor(() => expect(h.viewProps.length).toBeGreaterThan(0));
    const content = h.viewProps.at(-1)!.content as QuestionContent;
    expect(content.viz).toEqual(OVERRIDE); // override wins over the file's own envelope
    expect(content.vizSettings ?? null).toBeNull();
  });

  it('captures viz edits locally (never staged on the file) and hands them back on Update', async () => {
    const onApplyVizOverride = vi.fn();
    const onClose = vi.fn();
    setup(makeQuestion({ viz: SAVED_ENVELOPE }), {
      storyEmbedMode: 'saved-override',
      vizOverride: OVERRIDE,
      onApplyVizOverride,
      sourceBadge: 'saved',
      onClose,
    });
    fireEvent.click(await screen.findByLabelText('Trigger viz change'));
    // the viz edit must NOT be staged on the saved file
    expect(h.edits.filter(e => (e.changes as { content?: { viz?: unknown } })?.content?.viz)).toHaveLength(0);
    // …but it IS reflected in the editor content (live preview of the override)
    await waitFor(() => {
      const content = h.viewProps.at(-1)!.content as QuestionContent;
      expect(content.viz).toEqual(h.NEXT_ENVELOPE);
    });
    fireEvent.click(screen.getByLabelText('Update'));
    expect(onApplyVizOverride).toHaveBeenCalledWith(h.NEXT_ENVELOPE);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('story-embed modal — ephemeral mode', () => {
  it('shows the Ephemeral badge, hides the name input, and applies + deletes the draft on Update', async () => {
    const onEphemeralApply = vi.fn();
    const onClose = vi.fn();
    setup(makeQuestion({ query: '', connection_name: 'duckdb' }), {
      storyEmbedMode: 'ephemeral',
      onEphemeralApply,
      sourceBadge: 'ephemeral',
      onClose,
    });
    expect((await screen.findByLabelText('Story embed type')).textContent).toContain('Ephemeral');
    expect(screen.queryByLabelText('Question name')).toBeNull();
    fireEvent.click(screen.getByLabelText('Update'));
    await waitFor(() => expect(onEphemeralApply).toHaveBeenCalled());
    const applied = onEphemeralApply.mock.calls[0][0] as QuestionContent;
    expect(applied.connection_name).toBe('duckdb');
    expect(h.deleted).toEqual([FILE_ID]);
    expect(onClose).toHaveBeenCalled();
  });

  it('deletes the draft on Cancel without applying', async () => {
    const onEphemeralApply = vi.fn();
    setup(makeQuestion(), { storyEmbedMode: 'ephemeral', onEphemeralApply, sourceBadge: 'ephemeral' });
    fireEvent.click(await screen.findByLabelText('Cancel question edit'));
    await waitFor(() => expect(h.deleted).toEqual([FILE_ID]));
    expect(onEphemeralApply).not.toHaveBeenCalled();
  });
});

describe('story-embed modal — default (dashboard) semantics unchanged', () => {
  it('routes viz edits to the file when no storyEmbedMode is set', async () => {
    setup(makeQuestion(), {});
    fireEvent.click(await screen.findByLabelText('Trigger viz change'));
    const vizEdits = h.edits.filter(e => (e.changes as { content?: { viz?: unknown } })?.content?.viz);
    expect(vizEdits).toHaveLength(1);
  });
});
