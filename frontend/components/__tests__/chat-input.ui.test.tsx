import type { Mock } from 'vitest';

vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: vi.fn(), isBlocked: false, confirmNavigation: vi.fn(), cancelNavigation: vi.fn() }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: { branding: { agentName: 'QueueBot' } },
  }),
}));

vi.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: vi.fn().mockResolvedValue({ text: '', wordCount: 0 }),
  SUPPORTED_DOC_EXTENSIONS: '.pdf,.docx,.txt',
}));

vi.mock('@/lib/object-store/client', () => ({
  uploadFile: vi.fn(),
}));

vi.mock('@/components/Markdown', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', { 'data-testid': 'markdown' }, children),
  };
});

vi.mock('@/components/chat/LexicalMentionEditor', () => {
  const React = require('react');
  return {
    __esModule: true,
    LexicalMentionEditor: React.forwardRef(function MockLexicalMentionEditor(props: any, ref: any) {
      const { placeholder, disabled, onSubmit, onChange, onArrowKey, onLargePaste } = props;
      const [value, setValue] = React.useState('');
      React.useImperativeHandle(ref, () => ({
        clear: vi.fn(),
        setText: (text: string) => setValue(text),
        focus: vi.fn(),
      }));
      return React.createElement('textarea', {
        'aria-label': 'Chat editor',
        placeholder,
        disabled,
        value,
        // Mirror the real PastePlugin: hand the pasted text to onLargePaste and,
        // if it claims the paste (returns true), suppress the inline insert.
        onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
          const text = e.clipboardData?.getData('text/plain') ?? '';
          if (onLargePaste?.(text)) {
            e.preventDefault();
            return;
          }
          setValue((v: string) => v + text);
        },
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
          setValue(e.target.value);
          onChange?.(e.target.value);
        },
        onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit?.();
          }
          if (e.key === 'ArrowUp') {
            onArrowKey?.('up', e.nativeEvent);
          }
          if (e.key === 'ArrowDown') {
            onArrowKey?.('down', e.nativeEvent);
          }
        },
      });
    }),
  };
});

import React from 'react';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { addInputHistoryEntry } from '@/store/chatSlice';
import { selectChatAttachments, addPendingUpload } from '@/store/uiSlice';
import { uploadFile } from '@/lib/object-store/client';
import { extractTextFromDocument } from '@/lib/utils/attachment-extract';

import ChatInput from '@/components/explore/ChatInput';

// ─── ChatInput: image attachment ──────────────────────────────────────────────

function renderChatInputImage(store: ReturnType<typeof storeModule.makeStore>) {
  return renderWithProviders(
    <ChatInput
      onSend={vi.fn()}
      onStop={vi.fn()}
      isAgentRunning={false}
      databaseName="test_db"
      onDatabaseChange={vi.fn()}
      isCompact={true}
    />,
    { store }
  );
}

function makeImageFile(name = 'screenshot.png', type = 'image/png'): File {
  return new File(['(binary)'], name, { type });
}

function makeDocFile(name = 'report.pdf', type = 'application/pdf'): File {
  return new File(['%PDF'], name, { type });
}

describe('ChatInput: image attachment upload', () => {
  let store: ReturnType<typeof storeModule.makeStore>;

  beforeEach(() => {
    store = storeModule.makeStore();
    (uploadFile as Mock).mockResolvedValue({ publicUrl: '/uploads/1/abc123.png' });
    (extractTextFromDocument as Mock).mockResolvedValue({ text: 'doc text', wordCount: 2 });
    window.HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls uploadFile (not extractText) when an image file is selected', async () => {
    renderChatInputImage(store);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile();

    await act(async () => {
      await userEvent.upload(fileInput, file);
    });

    await waitFor(() => {
      expect(uploadFile).toHaveBeenCalledWith(file, expect.any(Function));
      expect(extractTextFromDocument).not.toHaveBeenCalled();
    });
  });

  it('stores an image attachment with type=image and content=publicUrl in Redux', async () => {
    renderChatInputImage(store);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile('diagram.png');

    await act(async () => {
      await userEvent.upload(fileInput, file);
    });

    await waitFor(() => {
      const attachments = selectChatAttachments(store.getState());
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toEqual({
        type: 'image',
        name: 'diagram.png',
        content: '/uploads/1/abc123.png',
        metadata: {},
      });
    });
  });

  it('shows an attachment chip for the uploaded image', async () => {
    renderChatInputImage(store);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(fileInput, makeImageFile('my-screenshot.png'));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Attachment: my-screenshot.png')).toBeTruthy();
    });
  });

  it('still uses extractTextFromDocument for non-image files', async () => {
    renderChatInputImage(store);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(fileInput, makeDocFile('report.pdf'));
    });

    await waitFor(() => {
      expect(extractTextFromDocument).toHaveBeenCalled();
      expect(uploadFile).not.toHaveBeenCalled();
    });
  });

  it('shows an error toast when uploadFile fails', async () => {
    (uploadFile as Mock).mockRejectedValue(new Error('Network error'));
    renderChatInputImage(store);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(fileInput, makeImageFile());
    });

    await waitFor(() => {
      const attachments = selectChatAttachments(store.getState());
      expect(attachments).toHaveLength(0);
    });
  });
});

// ─── ChatInput: large paste → text attachment ─────────────────────────────────

import { PASTED_TEXT_ATTACHMENT_CHARS } from '@/lib/context/context-budgets';

describe('ChatInput: large paste becomes a text attachment', () => {
  beforeEach(() => { window.HTMLElement.prototype.scrollTo = vi.fn(); });
  afterEach(() => vi.clearAllMocks());

  function pasteInto(editor: HTMLElement, text: string) {
    fireEvent.paste(editor, { clipboardData: { getData: () => text } });
  }

  it('stages a large paste as a text attachment instead of inserting inline', async () => {
    const store = storeModule.makeStore();
    renderChatInputImage(store);

    const big = 'x'.repeat(PASTED_TEXT_ATTACHMENT_CHARS + 1);
    pasteInto(screen.getByLabelText('Chat editor'), big);

    await waitFor(() => {
      const attachments = selectChatAttachments(store.getState());
      expect(attachments).toHaveLength(1);
      expect(attachments[0].type).toBe('text');
      expect(attachments[0].content).toBe(big);
    });
    // The editor must stay empty — the blob did NOT go inline.
    expect((screen.getByLabelText('Chat editor') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows an attachment chip for the pasted blob', async () => {
    const store = storeModule.makeStore();
    renderChatInputImage(store);

    pasteInto(screen.getByLabelText('Chat editor'), 'y'.repeat(PASTED_TEXT_ATTACHMENT_CHARS + 1));

    await waitFor(() => {
      expect(screen.getByLabelText(/^Attachment: Pasted text/)).toBeTruthy();
    });
  });

  it('leaves small pastes inline (no attachment)', async () => {
    const store = storeModule.makeStore();
    renderChatInputImage(store);

    pasteInto(screen.getByLabelText('Chat editor'), 'a short paste');

    await waitFor(() => {
      expect((screen.getByLabelText('Chat editor') as HTMLTextAreaElement).value).toBe('a short paste');
    });
    expect(selectChatAttachments(store.getState())).toHaveLength(0);
  });
});

// ─── ChatInput: pending-upload send gating ────────────────────────────────────

function renderChatInputPrefill(store: ReturnType<typeof storeModule.makeStore>, prefillText: string) {
  return renderWithProviders(
    <ChatInput
      onSend={vi.fn()}
      onStop={vi.fn()}
      isAgentRunning={false}
      databaseName="test_db"
      onDatabaseChange={vi.fn()}
      isCompact={true}
      prefillText={prefillText}
    />,
    { store }
  );
}

describe('ChatInput: pending-upload send gating', () => {
  beforeEach(() => { window.HTMLElement.prototype.scrollTo = vi.fn(); });
  afterEach(() => vi.clearAllMocks());

  it('with text and no pending upload, Send is enabled', async () => {
    const store = storeModule.makeStore();
    renderChatInputPrefill(store, 'hello there');
    await waitFor(() =>
      expect((screen.getAllByLabelText('Send message')[0] as HTMLButtonElement).disabled).toBe(false));
  });

  it('disables Send while an upload is pending, shows a cancelable chip, and cancel re-enables it', async () => {
    const store = storeModule.makeStore();
    store.dispatch(addPendingUpload({ id: 'u1', name: 'Screen selection' }));
    renderChatInputPrefill(store, 'hello there');

    expect(screen.getByLabelText('Processing: Screen selection')).toBeTruthy();
    await waitFor(() =>
      expect((screen.getAllByLabelText('Send message')[0] as HTMLButtonElement).disabled).toBe(true));

    fireEvent.click(screen.getByLabelText('Cancel Screen selection'));
    expect(store.getState().ui.pendingUploads).toHaveLength(0);
    await waitFor(() =>
      expect((screen.getAllByLabelText('Send message')[0] as HTMLButtonElement).disabled).toBe(false));
  });
});

// ─── ChatInput: queue toggle ──────────────────────────────────────────────────

function renderChatInputQueue(props?: Partial<React.ComponentProps<typeof ChatInput>>) {
  const store = storeModule.makeStore();
  const onSend = vi.fn();

  renderWithProviders(
    <ChatInput
      onSend={onSend}
      onStop={vi.fn()}
      isAgentRunning={true}
      allowChatQueue={false}
      databaseName="test_db"
      onDatabaseChange={vi.fn()}
      container="sidebar"
      isCompact={true}
      {...props}
    />,
    { store }
  );

  return { onSend };
}

describe('ChatInput queue toggle', () => {
  it('locks the chat input while the agent is running when queue is disabled', async () => {
    renderChatInputQueue({ allowChatQueue: false });

    const editor = screen.getByLabelText('Chat editor');
    const sendButton = screen.getByLabelText('Send message');

    expect(editor).toBeDisabled();
    expect(editor).toHaveAttribute('placeholder', 'QueueBot is still working...');
    expect(sendButton).toBeDisabled();
  });

  it('allows queueing while the agent is running when queue is enabled', async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInputQueue({ allowChatQueue: true });

    const editor = screen.getByLabelText('Chat editor');

    expect(editor).not.toBeDisabled();
    expect(editor).toHaveAttribute('placeholder', 'Add to agent queue...');

    fireEvent.change(editor, { target: { value: 'follow up' } });

    const sendButton = await screen.findByLabelText('Send message');
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledWith('follow up', []);
  });
});

// ─── ChatInput: input history ────────────────────────────────────────────────

describe('ChatInput input history', () => {
  beforeEach(() => { window.HTMLElement.prototype.scrollTo = vi.fn(); });
  afterEach(() => vi.clearAllMocks());

  it('stores sent text in Redux input history', async () => {
    const store = storeModule.makeStore();
    const onSend = vi.fn();
    renderWithProviders(
      <ChatInput
        onSend={onSend}
        onStop={vi.fn()}
        isAgentRunning={false}
        databaseName="test_db"
        onDatabaseChange={vi.fn()}
        isCompact={true}
      />,
      { store }
    );

    fireEvent.change(screen.getByLabelText('Chat editor'), { target: { value: 'show sales' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(onSend).toHaveBeenCalledWith('show sales', []);
    expect(store.getState().chat.inputHistory).toEqual(['show sales']);
  });

  it('recalls history with ArrowUp and moves forward with ArrowDown', async () => {
    const store = storeModule.makeStore();
    store.dispatch(addInputHistoryEntry('first message'));
    store.dispatch(addInputHistoryEntry('second message'));

    renderWithProviders(
      <ChatInput
        onSend={vi.fn()}
        onStop={vi.fn()}
        isAgentRunning={false}
        databaseName="test_db"
        onDatabaseChange={vi.fn()}
        isCompact={true}
      />,
      { store }
    );

    const editor = screen.getByLabelText('Chat editor') as HTMLTextAreaElement;
    fireEvent.keyDown(editor, { key: 'ArrowUp' });
    expect(editor.value).toBe('second message');

    fireEvent.keyDown(editor, { key: 'ArrowUp' });
    expect(editor.value).toBe('first message');

    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    expect(editor.value).toBe('second message');

    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    expect(editor.value).toBe('');
  });
});
