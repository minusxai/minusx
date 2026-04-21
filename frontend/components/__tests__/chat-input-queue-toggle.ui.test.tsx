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
    config: {
      branding: { agentName: 'QueueBot' },
    },
  }),
}));

jest.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: jest.fn().mockResolvedValue({ text: '', wordCount: 0 }),
  SUPPORTED_DOC_EXTENSIONS: '.pdf,.docx,.txt',
}));

jest.mock('@/lib/object-store/client', () => ({
  uploadFile: jest.fn(),
}));

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
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import ChatInput from '@/components/explore/ChatInput';

function renderChatInput(props?: Partial<React.ComponentProps<typeof ChatInput>>) {
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
    renderChatInput({ allowChatQueue: false });

    const editor = screen.getByLabelText('Chat editor');
    const sendButton = screen.getByLabelText('Send message');

    expect(editor).toBeDisabled();
    expect(editor).toHaveAttribute('placeholder', 'QueueBot is still working...');
    expect(sendButton).toBeDisabled();
  });

  it('allows queueing while the agent is running when queue is enabled', async () => {
    const user = userEvent.setup();
    const { onSend } = renderChatInput({ allowChatQueue: true });

    const editor = screen.getByLabelText('Chat editor');
    const sendButton = screen.getByLabelText('Send message');

    expect(editor).not.toBeDisabled();
    expect(editor).toHaveAttribute('placeholder', 'Add to agent queue...');

    await user.type(editor, 'follow up');
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledWith('follow up', []);
  });
});
