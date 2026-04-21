jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

jest.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: jest.fn(), isBlocked: false, confirmNavigation: jest.fn(), cancelNavigation: jest.fn() }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: { branding: { agentName: 'QueueBot' } },
  }),
}));

jest.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: jest.fn().mockResolvedValue({ text: '', wordCount: 0 }),
  SUPPORTED_DOC_EXTENSIONS: '.pdf,.docx,.txt',
}));

jest.mock('@/lib/object-store/client', () => ({
  uploadFile: jest.fn(),
}));

jest.mock('@/components/Markdown', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', { 'data-testid': 'markdown' }, children),
  };
});

jest.mock('@/components/chat/LexicalMentionEditor', () => {
  const React = require('react');
  return {
    __esModule: true,
    LexicalMentionEditor: React.forwardRef(function MockLexicalMentionEditor(props: any, ref: any) {
      const { placeholder, disabled, onSubmit, onChange } = props;
      React.useImperativeHandle(ref, () => ({
        clear: jest.fn(),
        setText: jest.fn(),
        focus: jest.fn(),
      }));
      return React.createElement('textarea', {
        'aria-label': 'Chat editor',
        placeholder,
        disabled,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
        onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit?.();
          }
        },
      });
    }),
  };
});

import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { selectChatAttachments } from '@/store/uiSlice';
import { uploadFile } from '@/lib/object-store/client';
import { extractTextFromDocument } from '@/lib/utils/attachment-extract';

import ChatInput from '@/components/explore/ChatInput';

// ─── ChatInput: image attachment ──────────────────────────────────────────────

function renderChatInputImage(store: ReturnType<typeof storeModule.makeStore>) {
  return renderWithProviders(
    <ChatInput
      onSend={jest.fn()}
      onStop={jest.fn()}
      isAgentRunning={false}
      databaseName="test_db"
      onDatabaseChange={jest.fn()}
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
    (uploadFile as jest.Mock).mockResolvedValue({ publicUrl: '/uploads/1/abc123.png' });
    (extractTextFromDocument as jest.Mock).mockResolvedValue({ text: 'doc text', wordCount: 2 });
    window.HTMLElement.prototype.scrollTo = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
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
    (uploadFile as jest.Mock).mockRejectedValue(new Error('Network error'));
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

// ─── ChatInput: queue toggle ──────────────────────────────────────────────────

function renderChatInputQueue(props?: Partial<React.ComponentProps<typeof ChatInput>>) {
  const store = storeModule.makeStore();
  const onSend = jest.fn();

  renderWithProviders(
    <ChatInput
      onSend={onSend}
      onStop={jest.fn()}
      isAgentRunning={true}
      allowChatQueue={false}
      databaseName="test_db"
      onDatabaseChange={jest.fn()}
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
    const sendButton = screen.getByLabelText('Send message');

    expect(editor).not.toBeDisabled();
    expect(editor).toHaveAttribute('placeholder', 'Add to agent queue...');

    await user.type(editor, 'follow up');
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledWith('follow up', []);
  });
});
