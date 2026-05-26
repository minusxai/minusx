// Regression test for "Enter sends nothing, message disappears" — sidebar chat.
//
// Why this exists separately from chat-input.ui.test.tsx:
// The existing tests mock LexicalMentionEditor with a textarea whose onKeyDown
// reads `onSubmit` from the CURRENT props closure on every keystroke. That mock
// always sees the latest onSubmit, so it cannot reproduce the production bug.
//
// In production, LexicalMentionEditor is React.memo'd with `lexicalEditorPropsEqual`,
// which strips `onSubmit` from the comparison ("must be a stable callback"
// contract). When ChatInput re-renders with a fresh `handleSend` closure, memo
// SKIPS LexicalMentionEditor's re-render. Its child OnSubmitPlugin therefore
// never gets the new onSubmit prop, its useEffect (deps `[editor, onSubmit]`)
// never re-runs, and the registered KEY_ENTER_COMMAND handler keeps invoking
// the FIRST-MOUNT onSubmit closure — which captured `input=''`.
//
// This test mocks LexicalMentionEditor to mimic that captured-once behavior so
// we can drive the same code path from a unit test.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined, DB_PATH: undefined, DB_DIR: undefined, getDbType: () => 'pglite' as const,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/object-store/client', () => ({ uploadFile: vi.fn() }));
vi.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: vi.fn(),
  SUPPORTED_DOC_EXTENSIONS: '.pdf,.txt,.md',
}));

// Mock LexicalMentionEditor: captures `onSubmit` ONCE at mount (mimicking the
// memo + useEffect-deps stale-closure behavior in real Lexical). Subsequent
// renders with a new onSubmit prop are IGNORED — the original captured one is
// what fires on Enter. onChange is wired to a textarea, so typing updates
// ChatInput's internal `input` state and ChatInput re-renders.
vi.mock('@/components/chat/LexicalMentionEditor', () => {
  const Module = require('react') as typeof import('react');
  return {
    __esModule: true,
    LexicalMentionEditor: Module.forwardRef(function MockLexicalMentionEditor(props: any, ref: any) {
      const { onSubmit, onChange, placeholder, disabled } = props;
      // Capture onSubmit ONCE at mount and never refresh it — this is the
      // production behaviour for memo + useEffect-deps when onSubmit is unstable.
      const onSubmitRef = Module.useRef(onSubmit);
      Module.useImperativeHandle(ref, () => ({ clear: vi.fn(), setText: vi.fn(), focus: vi.fn() }));
      return Module.createElement('textarea', {
        'aria-label': 'Chat editor',
        placeholder,
        disabled,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
        onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // Fire the captured (mount-time) onSubmit, NOT the current props one.
            onSubmitRef.current?.();
          }
        },
      });
    }),
  };
});

import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import ChatInput from '@/components/explore/ChatInput';

describe('ChatInput: Enter key submits latest input (stale-closure regression)', () => {
  let store: ReturnType<typeof storeModule.makeStore>;

  beforeEach(() => {
    store = storeModule.makeStore();
    window.HTMLElement.prototype.scrollTo = vi.fn();
  });

  it('Enter sends the message with the CURRENT input value, not the mount-time empty value', async () => {
    const onSend = vi.fn();
    const { findByLabelText } = renderWithProviders(
      <ChatInput
        onSend={onSend}
        onStop={vi.fn()}
        isAgentRunning={false}
        databaseName="test_db"
        onDatabaseChange={vi.fn()}
        isCompact={true}
      />,
      { store },
    );

    const editor = (await findByLabelText('Chat editor')) as HTMLTextAreaElement;

    // Type a message — onChange flows to ChatInput's setInput state.
    fireEvent.change(editor, { target: { value: 'hello world' } });

    // Press Enter — production code fires the MOUNT-TIME captured onSubmit
    // (mocked above), which calls the mount-time `handleSend`. If handleSend
    // is a fresh closure each render, that captured handleSend sees `input=''`
    // and short-circuits. With the fix (useStableCallback in ChatInput),
    // the mount-time handleSend is a stable wrapper that always reads the
    // latest input.
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter' });

    // Allow microtasks/state updates to flush.
    await new Promise((r) => setTimeout(r, 30));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hello world', []);
  });
});
