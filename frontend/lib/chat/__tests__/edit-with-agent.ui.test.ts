/**
 * Shared core for the "Interact with {agentName}" select-to-chat feature.
 *
 * - buildEditAttachmentName: provenance string the AGENT receives (server drops
 *   attachment metadata, so the name carries file/line info).
 * - composeInteractMessage: the action framing + the user's text.
 * - sendInteractSelection: the send sequence. ORDER IS LOAD-BEARING — the snippet
 *   attachment is staged BEFORE the pending message so the sidebar ChatInput effect
 *   picks it up when it auto-sends.
 * - computeMonacoPopoverPosition: viewport coords + line range from a Monaco editor.
 */

import {
  buildEditAttachmentName,
  composeInteractMessage,
  sendInteractSelection,
  computeMonacoPopoverPosition,
  computeSelectionPopoverPosition,
  getShadowRootSelection,
  AGENT_ACTIONS,
  type EditWithAgentSource,
} from '@/lib/chat/edit-with-agent';
import { addChatAttachment, setSidebarPendingMessage, setRightSidebarCollapsed, setActiveSidebarSection } from '@/store/uiSlice';

const ask = AGENT_ACTIONS.find((a) => a.key === 'ask')!;
const edit = AGENT_ACTIONS.find((a) => a.key === 'edit')!;

describe('buildEditAttachmentName', () => {
  it('labels a multi-line SQL selection with the line range', () => {
    const source: EditWithAgentSource = { editorKind: 'sql', fileName: 'Revenue', filePath: '/org/Revenue', fileId: 7, lineRange: { start: 3, end: 7 } };
    expect(buildEditAttachmentName(source)).toBe('Selection from Revenue (SQL, lines 3–7) [/org/Revenue]');
  });

  it('labels a single-line SQL selection with one line number', () => {
    const source: EditWithAgentSource = { editorKind: 'sql', fileName: 'Revenue', lineRange: { start: 3, end: 3 } };
    expect(buildEditAttachmentName(source)).toBe('Selection from Revenue (SQL, line 3)');
  });

  it('labels a rich-text selection without line info', () => {
    const source: EditWithAgentSource = { editorKind: 'richtext', fileName: 'Summary', filePath: '/org/Summary' };
    expect(buildEditAttachmentName(source)).toBe('Selection from Summary (text) [/org/Summary]');
  });

  it('omits the path suffix when no filePath is present', () => {
    const source: EditWithAgentSource = { editorKind: 'richtext', fileName: 'doc 1' };
    expect(buildEditAttachmentName(source)).toBe('Selection from doc 1 (text)');
  });
});

describe('composeInteractMessage', () => {
  it('prepends the action framing to the user text', () => {
    expect(composeInteractMessage(ask, 'what does this mean?')).toBe('Answer a question about the attached selection: what does this mean?');
    expect(composeInteractMessage(edit, 'make it count(*)')).toBe('Edit the attached selection as follows: make it count(*)');
  });

  it('falls back to just the framing when the user text is blank', () => {
    expect(composeInteractMessage(edit, '   ')).toBe('Edit the attached selection as follows:');
  });
});

describe('sendInteractSelection', () => {
  it('stages the snippet attachment FIRST, then opens chat and sends the framed message', () => {
    const dispatch = vi.fn();
    const source: EditWithAgentSource = { editorKind: 'sql', fileName: 'Revenue', filePath: '/org/Revenue', lineRange: { start: 2, end: 2 } };
    sendInteractSelection(dispatch, { selectedText: 'select 1', instruction: 'make it count(*)', action: edit, source });

    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(dispatch.mock.calls[0][0]).toEqual(
      addChatAttachment({
        type: 'text',
        name: 'Selection from Revenue (SQL, line 2) [/org/Revenue]',
        content: 'select 1',
        metadata: { language: 'sql', sourceLabel: 'Revenue' },
      }),
    );
    expect(dispatch.mock.calls[1][0]).toEqual(setSidebarPendingMessage('Edit the attached selection as follows: make it count(*)'));
    expect(dispatch.mock.calls[2][0]).toEqual(setRightSidebarCollapsed(false));
    expect(dispatch.mock.calls[3][0]).toEqual(setActiveSidebarSection('chat'));
  });

  it('marks rich-text snippets with the text language', () => {
    const dispatch = vi.fn();
    const source: EditWithAgentSource = { editorKind: 'richtext', fileName: 'Summary' };
    sendInteractSelection(dispatch, { selectedText: 'hello', instruction: 'fix grammar', action: edit, source });
    expect(dispatch.mock.calls[0][0]).toEqual(
      addChatAttachment({ type: 'text', name: 'Selection from Summary (text)', content: 'hello', metadata: { language: 'text', sourceLabel: 'Summary' } }),
    );
  });
});

describe('computeMonacoPopoverPosition', () => {
  const makeEditor = (overrides: Partial<Record<string, unknown>> = {}) => ({
    getSelection: () => ({ isEmpty: () => false, startLineNumber: 4, endLineNumber: 9, getEndPosition: () => ({ lineNumber: 9, column: 2 }) }),
    getModel: () => ({ getValueInRange: () => 'SELECT *\nFROM t' }),
    getScrolledVisiblePosition: () => ({ top: 50, left: 30 }),
    getDomNode: () => ({ getBoundingClientRect: () => ({ left: 100, top: 200 }) }),
    ...overrides,
  });

  it('returns viewport coords (editor rect + visible position) plus the line range and text', () => {
    const result = computeMonacoPopoverPosition(makeEditor() as never);
    expect(result).toEqual({ x: 130, y: 268, text: 'SELECT *\nFROM t', lineRange: { start: 4, end: 9 } });
  });

  it('returns null for an empty selection', () => {
    const editor = makeEditor({ getSelection: () => ({ isEmpty: () => true, getEndPosition: () => ({}) }) });
    expect(computeMonacoPopoverPosition(editor as never)).toBeNull();
  });

  it('returns null for a whitespace-only selection', () => {
    const editor = makeEditor({ getModel: () => ({ getValueInRange: () => '   \n  ' }) });
    expect(computeMonacoPopoverPosition(editor as never)).toBeNull();
  });
});

describe('getShadowRootSelection', () => {
  it("prefers the shadow root's own getSelection (Chrome) when present", () => {
    const shadowSel = { isCollapsed: false } as unknown as Selection;
    const root = { getSelection: () => shadowSel } as unknown as ShadowRoot;
    expect(getShadowRootSelection(root)).toBe(shadowSel);
  });

  it('falls back to the document selection when the root lacks getSelection (Firefox/Safari) or is null', () => {
    const docSel = { isCollapsed: true } as unknown as Selection;
    const orig = window.getSelection;
    window.getSelection = (() => docSel) as typeof window.getSelection;
    try {
      expect(getShadowRootSelection({} as ShadowRoot)).toBe(docSel);
      expect(getShadowRootSelection(null)).toBe(docSel);
    } finally {
      window.getSelection = orig;
    }
  });
});

describe('computeSelectionPopoverPosition', () => {
  const makeSel = (overrides: Partial<Record<string, unknown>> = {}) => ({
    isCollapsed: false,
    rangeCount: 1,
    toString: () => 'hello world',
    getRangeAt: () => ({
      // Anchor at the END of the selection → the LAST client rect.
      getClientRects: () => [{ right: 40, bottom: 10 }, { right: 120, bottom: 40 }],
      getBoundingClientRect: () => ({ right: 200, bottom: 80 }),
    }),
    ...overrides,
  });

  it('anchors at the right/bottom of the last client rect (+4px gap)', () => {
    expect(computeSelectionPopoverPosition(makeSel() as never)).toEqual({ x: 120, y: 44, text: 'hello world' });
  });

  it('falls back to the bounding rect when there are no client rects', () => {
    const sel = makeSel({ getRangeAt: () => ({ getClientRects: () => [], getBoundingClientRect: () => ({ right: 200, bottom: 80 }) }) });
    expect(computeSelectionPopoverPosition(sel as never)).toEqual({ x: 200, y: 84, text: 'hello world' });
  });

  it('returns null for a null, collapsed, or range-less selection', () => {
    expect(computeSelectionPopoverPosition(null)).toBeNull();
    expect(computeSelectionPopoverPosition(makeSel({ isCollapsed: true }) as never)).toBeNull();
    expect(computeSelectionPopoverPosition(makeSel({ rangeCount: 0 }) as never)).toBeNull();
  });

  it('returns null for a whitespace-only selection', () => {
    expect(computeSelectionPopoverPosition(makeSel({ toString: () => '   ' }) as never)).toBeNull();
  });
});
