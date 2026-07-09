// Remote Agent Sessions — UI: hard input freeze, the session banner + Stop, and the
// Copy-to-Agent button (mint + clipboard). aria-label queries only, per house rules.



vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'TestBot' } } }),
}));

vi.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: vi.fn().mockResolvedValue({ text: '', wordCount: 0 }),
  SUPPORTED_DOC_EXTENSIONS: '.pdf,.docx,.txt',
}));

vi.mock('@/lib/object-store/client', () => ({ uploadFile: vi.fn() }));

vi.mock('@/components/chat/LexicalMentionEditor', () => {
  const React = require('react');
  return {
    __esModule: true,
    LexicalMentionEditor: React.forwardRef(function MockEditor(props: any, ref: any) {
      React.useImperativeHandle(ref, () => ({ clear: vi.fn(), setText: vi.fn(), focus: vi.fn() }));
      return React.createElement('textarea', {
        'aria-label': 'Chat editor',
        placeholder: props.placeholder,
        disabled: props.disabled,
      });
    }),
  };
});

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import ChatInput from '@/components/explore/ChatInput';
import RemoteSessionBanner from '@/components/explore/RemoteSessionBanner';
import ChatHeaderBar from '@/components/explore/ChatHeaderBar';
import RemoteSessionPrompts from '@/components/remote/RemoteSessionPrompts';
import { loadConversation, setRemoteSession, addUserInputRequest } from '@/store/chatSlice';

describe('ChatInput: remote session hard freeze', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollTo = vi.fn();
  });
  afterEach(() => vi.clearAllMocks());

  function renderInput(extra: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
    return renderWithProviders(
      <ChatInput
        onSend={vi.fn()}
        onStop={vi.fn()}
        isAgentRunning={false}
        databaseName="db"
        onDatabaseChange={vi.fn()}
        isCompact={true}
        {...extra}
      />,
      { store: storeModule.makeStore() },
    );
  }

  it('remoteSessionActive hard-locks the editor even when queueing is allowed', () => {
    renderInput({ remoteSessionActive: true, allowChatQueue: true });
    const editor = screen.getByLabelText('Chat editor') as HTMLTextAreaElement;
    expect(editor.disabled).toBe(true);
    expect(editor.placeholder.toLowerCase()).toContain('remote');
  });

  it('without the flag, queueing keeps the editor enabled while the agent runs', () => {
    renderInput({ isAgentRunning: true, allowChatQueue: true });
    const editor = screen.getByLabelText('Chat editor') as HTMLTextAreaElement;
    expect(editor.disabled).toBe(false);
  });
});

describe('RemoteSessionBanner', () => {
  it('renders and Stop invokes the handler', async () => {
    const onStop = vi.fn();
    renderWithProviders(
      <RemoteSessionBanner expiresAt={new Date(Date.now() + 3600_000).toISOString()} onStop={onStop} />,
      { store: storeModule.makeStore() },
    );
    expect(screen.getByLabelText('Remote session banner')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Stop remote session'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('ChatHeaderBar: Copy to Agent', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function renderHeader(overrides: Partial<React.ComponentProps<typeof ChatHeaderBar>> = {}) {
    return renderWithProviders(
      <ChatHeaderBar
        container="sidebar"
        conversationID={1234}
        providedConversationId={undefined}
        hasConversation={true}
        isConversationActive={true}
        conversationTitle="My chat"
        hasMessages={true}
        isExplorePage={false}
        navigate={vi.fn()}
        handleNewChat={vi.fn()}
        {...overrides}
      />,
      { store: storeModule.makeStore() },
    );
  }

  it('mints a session and copies the copyText to the clipboard', async () => {
    const copyText = 'Fetch http://localhost:3000/s/ya-abc and follow its instructions to operate my MinusX session.';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { url: 'http://localhost:3000/s/ya-abc', code: 'ya-abc', expiresAt: new Date().toISOString(), copyText } }),
    }) as unknown as typeof fetch;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderHeader();
    await userEvent.click(screen.getByLabelText('Copy to agent'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/conversations/1234/remote-session'),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(writeText).toHaveBeenCalledWith(copyText);
    });
  });

  it('is disabled while the agent is running (mint guard mirrored in UI)', () => {
    renderHeader({ agentBusy: true });
    const btn = screen.getByLabelText('Copy to agent') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});


describe('RemoteSessionPrompts: global approval host', () => {
  function storeWithPendingConfirm(remote: boolean) {
    const store = storeModule.makeStore();
    store.dispatch(loadConversation({
      conversation: {
        _id: 'rp-1',
        conversationID: 900,
        log_index: 1,
        messages: [],
        executionState: 'EXECUTING',
        pending_tool_calls: [{
          toolCall: { id: 'tc-1', type: 'function', function: { name: 'Navigate', arguments: { file_id: 7 } } },
          result: undefined,
        }],
        streamedCompletedToolCalls: [],
        streamedThinking: '',
        agent: 'WebAnalystAgent',
        agent_args: {},
        version: 3,
      } as never,
      setAsActive: false,
    }));
    if (remote) store.dispatch(setRemoteSession({ conversationID: 900, active: true }));
    store.dispatch(addUserInputRequest({
      conversationID: 900,
      tool_call_id: 'tc-1',
      userInput: {
        id: 'ui-1',
        props: { type: 'confirmation', title: 'Navigation request', message: 'The agent wants to navigate to file "7". Allow it?' },
        result: undefined,
        providedAt: undefined,
      } as never,
    }));
    return store;
  }

  it('surfaces a remote session pending approval GLOBALLY (independent of the chat view)', () => {
    const store = storeWithPendingConfirm(true);
    renderWithProviders(<RemoteSessionPrompts />, { store });
    expect(screen.getByLabelText('Remote session prompts')).toBeTruthy();
    expect(screen.getByLabelText('Remote prompt: Navigation request')).toBeTruthy();
  });

  it('renders nothing when no remote session is active (normal chats keep inline prompts)', () => {
    const store = storeWithPendingConfirm(false);
    renderWithProviders(<RemoteSessionPrompts />, { store });
    expect(screen.queryByLabelText('Remote session prompts')).toBeNull();
  });

  it('renders nothing when the remote session has no unresolved inputs', () => {
    const store = storeModule.makeStore();
    store.dispatch(loadConversation({
      conversation: {
        _id: 'rp-2', conversationID: 901, log_index: 0, messages: [], executionState: 'FINISHED',
        pending_tool_calls: [], streamedCompletedToolCalls: [], streamedThinking: '',
        agent: 'WebAnalystAgent', agent_args: {}, version: 3,
      } as never,
      setAsActive: false,
    }));
    store.dispatch(setRemoteSession({ conversationID: 901, active: true }));
    renderWithProviders(<RemoteSessionPrompts />, { store });
    expect(screen.queryByLabelText('Remote session prompts')).toBeNull();
  });
});
