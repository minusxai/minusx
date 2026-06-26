'use client';

/**
 * Shared core for the "Interact with {agentName}" select-to-chat feature: when a
 * user selects text in an editor (Lexical rich-text or Monaco SQL), a floating pill
 * lets them Ask or Edit that selection via chat.
 *
 * The selection is sent as a VISIBLE text attachment — it renders as an expandable
 * chip in the chat transcript (see components/explore/TextAttachmentCard.tsx), like
 * image attachments do. The agent receives the attachment's `name` + `content`; the
 * server drops `metadata` (see lib/chat/attachments.server.ts), so the name encodes
 * the provenance (file + lines) while `metadata` only feeds the chip UI.
 */

import { useCallback } from 'react';
import { useAppDispatch } from '@/store/hooks';
import type { AppDispatch } from '@/store/store';
import {
  addChatAttachment,
  setSidebarPendingMessage,
  setRightSidebarCollapsed,
  setActiveSidebarSection,
} from '@/store/uiSlice';

export interface EditWithAgentSource {
  editorKind: 'sql' | 'richtext';
  /** Human label for the chip + attachment name, e.g. the file/cell title. */
  fileName: string;
  /** File path — preferred provenance the agent uses to locate the file. */
  filePath?: string;
  /** Question id (SQL editor). */
  fileId?: number;
  /** Dashboard block / notebook cell id. */
  blockId?: string;
  /** SQL selection line range (1-based, inclusive). */
  lineRange?: { start: number; end: number };
}

/**
 * Build the attachment name — the provenance channel that reaches the agent.
 * Examples:
 *   Selection from Revenue (SQL, lines 3–7) [/org/Revenue]
 *   Selection from Revenue (SQL, line 3)
 *   Selection from Summary (text) [/org/Summary]
 */
export function buildEditAttachmentName(source: EditWithAgentSource): string {
  let descriptor: string;
  if (source.editorKind === 'sql' && source.lineRange) {
    const { start, end } = source.lineRange;
    descriptor = start === end ? `SQL, line ${start}` : `SQL, lines ${start}–${end}`;
  } else if (source.editorKind === 'sql') {
    descriptor = 'SQL';
  } else {
    descriptor = 'text';
  }
  const suffix = source.filePath ? ` [${source.filePath}]` : '';
  return `Selection from ${source.fileName} (${descriptor})${suffix}`;
}

/** The ways a user can act on a selection. Each carries its own framing (metaInstruction). */
export type AgentActionKey = 'ask' | 'edit';

export interface AgentAction {
  key: AgentActionKey;
  /** Short verb shown on the pill button. */
  label: string;
  /** Header question shown above the composer once this action is chosen. */
  prompt: string;
  /** Example ghost text for the composer input. */
  placeholder: string;
  /** Prefix that frames the user's text for the agent (the "custom meta instruction"). */
  metaInstruction: string;
}

export const AGENT_ACTIONS: AgentAction[] = [
  {
    key: 'ask',
    label: 'Ask',
    prompt: 'What would you like to ask?',
    placeholder: 'e.g. what does this calculate?',
    metaInstruction: 'Answer a question about the attached selection:',
  },
  {
    key: 'edit',
    label: 'Edit',
    prompt: 'How would you like to modify this?',
    placeholder: 'e.g. make this more concise',
    metaInstruction: 'Edit the attached selection as follows:',
  },
];

export const DEFAULT_AGENT_ACTION: AgentActionKey = 'ask';

/** Compose the chat message: the action's framing + the user's text. */
export function composeInteractMessage(action: AgentAction, userInstruction: string): string {
  const trimmed = userInstruction.trim();
  return trimmed ? `${action.metaInstruction} ${trimmed}` : action.metaInstruction;
}

export interface SendInteractArgs {
  selectedText: string;
  instruction: string;
  action: AgentAction;
  source: EditWithAgentSource;
}

/**
 * Stage the selection as a visible text attachment and auto-send the framed message.
 *
 * ORDER IS LOAD-BEARING: the attachment is dispatched BEFORE the pending message so
 * it is already in `state.ui.chatAttachments` when the sidebar ChatInput's
 * pending-message effect fires `onSend(pendingMessage, attachments)` and then clears
 * both (see components/explore/ChatInput.tsx).
 */
export function sendInteractSelection(dispatch: AppDispatch, { selectedText, instruction, action, source }: SendInteractArgs): void {
  dispatch(addChatAttachment({
    type: 'text',
    name: buildEditAttachmentName(source),
    content: selectedText,
    metadata: { language: source.editorKind === 'sql' ? 'sql' : 'text', sourceLabel: source.fileName },
  }));
  dispatch(setSidebarPendingMessage(composeInteractMessage(action, instruction)));
  dispatch(setRightSidebarCollapsed(false));
  dispatch(setActiveSidebarSection('chat'));
}

/** Thin hook wrapper so components don't wire up dispatch + helper separately. */
export function useEditWithAgent(): (args: SendInteractArgs) => void {
  const dispatch = useAppDispatch();
  return useCallback((args: SendInteractArgs) => sendInteractSelection(dispatch, args), [dispatch]);
}

/** Minimal slice of a DOM Selection used to position the popover — keeps this file DOM-type-free. */
interface SelectionLike {
  isCollapsed: boolean;
  rangeCount: number;
  toString(): string;
  getRangeAt(index: number): {
    getClientRects?: () => ArrayLike<{ right: number; bottom: number }>;
    getBoundingClientRect: () => { right: number; bottom: number };
  };
}

/**
 * Read the active text selection within a story. The story renders inside a same-origin iframe, so
 * pass its `contentWindow` (which has its own `getSelection()` scoped to the iframe document). Falls
 * back to the top `window.getSelection()` when `root` is null or has no `getSelection` (also covers a
 * shadow root's non-standard `shadowRoot.getSelection()` for back-compat).
 */
export function getShadowRootSelection(root: { getSelection?: () => SelectionLike | null } | null): SelectionLike | null {
  const scopedGetSelection = root?.getSelection;
  if (scopedGetSelection) return scopedGetSelection.call(root);
  return window.getSelection() as unknown as SelectionLike | null;
}

export interface SelectionPopoverPosition {
  x: number;
  y: number;
  text: string;
}

/**
 * Viewport coords + text for the popover anchored at the END of a DOM text selection
 * (last client rect, right/bottom edge — mirrors the Lexical & SQL editors). Returns
 * null when the selection is null, collapsed, or whitespace-only. Pure given the
 * selection, so it's unit-testable with a fake. The DOM analog of computeMonacoPopoverPosition.
 */
export function computeSelectionPopoverPosition(sel: SelectionLike | null): SelectionPopoverPosition | null {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects?.();
  const rect = rects && rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  return { x: rect.right, y: rect.bottom + 4, text };
}

/** Minimal slice of the Monaco editor API used for positioning — keeps this file monaco-type-free. */
interface MonacoLikeEditor {
  getSelection(): { isEmpty(): boolean; startLineNumber: number; endLineNumber: number; getEndPosition(): unknown } | null;
  getModel(): { getValueInRange(range: unknown): string } | null;
  getScrolledVisiblePosition(pos: unknown): { top: number; left: number } | null;
  getDomNode(): { getBoundingClientRect(): { left: number; top: number } } | null;
}

export interface MonacoPopoverPosition {
  x: number;
  y: number;
  text: string;
  lineRange: { start: number; end: number };
}

/**
 * Compute viewport coords for the popover anchored at the end of the current Monaco
 * selection, plus the selected text + line range. Returns null when there is no
 * meaningful (non-empty, non-whitespace) selection. Pure given the editor's getters,
 * so it's unit-testable with a fake editor.
 */
export function computeMonacoPopoverPosition(editor: MonacoLikeEditor): MonacoPopoverPosition | null {
  const sel = editor.getSelection();
  const model = editor.getModel();
  if (!sel || !model || sel.isEmpty()) return null;
  const text = model.getValueInRange(sel);
  if (!text.trim()) return null;
  const vp = editor.getScrolledVisiblePosition(sel.getEndPosition());
  const rect = editor.getDomNode()?.getBoundingClientRect();
  if (!vp || !rect) return null;
  return {
    x: rect.left + vp.left,
    y: rect.top + vp.top + 18,
    text,
    lineRange: { start: sel.startLineNumber, end: sel.endLineNumber },
  };
}
