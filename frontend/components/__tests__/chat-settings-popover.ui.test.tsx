import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { setUser } from '@/store/authSlice';

const hookState = vi.hoisted(() => ({
  connections: {
    warehouse: { metadata: { name: 'warehouse', type: 'postgres' } },
    analytics: { metadata: { name: 'analytics', type: 'bigquery' } },
  },
  contexts: [
    {
      id: 7,
      name: 'context.json',
      path: '/tutorial/context.json',
      type: 'context',
      content: {
        published: { all: 2 },
        versions: [
          { version: 1, description: 'Draft' },
          { version: 2, description: 'Published' },
        ],
      },
    },
    { id: 8, name: 'context.json', path: '/tutorial/testing/context.json', type: 'context', content: null },
    { id: 9, name: 'context.json', path: '/tutorial/configs/context.json', type: 'context', content: null },
    { id: 10, name: 'context.json', path: '/tutorial/database/context.json', type: 'context', content: null },
    { id: 11, name: 'context.json', path: '/tutorial/logs/conversations/context.json', type: 'context', content: null },
    { id: 12, name: 'context.json', path: '/tutorial/recordings/context.json', type: 'context', content: null },
    { id: 13, name: 'context.json', path: '/org/outside/context.json', type: 'context', content: null },
    { id: -1, name: 'context.json', path: '/tutorial/placeholder/context.json', type: 'context', content: null },
  ],
}));

vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ connections: hookState.connections, loading: false, error: null }),
}));

vi.mock('@/lib/hooks/useContexts', () => ({
  useContexts: () => ({
    contexts: hookState.contexts,
    homeContext: hookState.contexts[0],
    loading: false,
    error: null,
  }),
}));

import ChatSettingsPopover from '@/components/explore/ChatSettingsPopover';

describe('ChatSettingsPopover', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollTo = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          defaultModel: {
            providerName: 'openai',
            providerLabel: 'OpenAI',
            model: 'gpt-5.4',
            modelLabel: 'GPT-5.4',
          },
          models: [
            {
              providerName: 'openai',
              providerLabel: 'OpenAI',
              model: 'gpt-5.4',
              modelLabel: 'GPT-5.4',
            },
            {
              providerName: 'openai',
              providerLabel: 'OpenAI',
              model: 'gpt-5.5',
              modelLabel: 'GPT-5.5',
            },
          ],
        },
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps one stable summary trigger and uses the app comboboxes inside one click-only panel', async () => {
    const user = userEvent.setup();
    const onDatabaseChange = vi.fn();
    const onModelChange = vi.fn();
    const onContextChange = vi.fn();
    function StatefulPopover() {
      const [selectedModel, setSelectedModel] = React.useState<{
        providerName: string;
        model?: string;
      } | null>(null);
      return (
        <ChatSettingsPopover
          databaseName="warehouse"
          onDatabaseChange={onDatabaseChange}
          selectedModel={selectedModel}
          onModelChange={(model) => {
            setSelectedModel(model);
            onModelChange(model);
          }}
          selectedContextPath="/tutorial/context.json"
          selectedVersion={2}
          onContextChange={onContextChange}
        />
      );
    }
    const { store } = renderWithProviders(
      <StatefulPopover />,
    );
    store.dispatch(setUser({
      id: 1,
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      home_folder: '',
      mode: 'tutorial',
    }));

    const trigger = screen.getByLabelText('Chat settings');
    expect(trigger).toHaveTextContent('warehouse');
    expect(trigger).toHaveTextContent('General agent');
    await waitFor(() => expect(trigger).toHaveTextContent('GPT-5.4'));
    expect(trigger).toHaveTextContent(/warehouse.*General agent.*GPT-5\.4/);
    expect(screen.queryByLabelText('Database')).not.toBeInTheDocument();

    await user.click(trigger);

    expect(screen.getByText('Configure this chat')).toBeInTheDocument();
    expect(screen.queryByText('Tune the next response')).not.toBeInTheDocument();
    const knowledgeBase = await screen.findByLabelText('Knowledge base');
    const database = screen.getByLabelText('Database');
    const model = screen.getByLabelText('LLM');
    expect(knowledgeBase.tagName).toBe('BUTTON');
    expect(database.tagName).toBe('BUTTON');
    expect(model.tagName).toBe('BUTTON');
    expect(screen.getByTestId('chat-setting-knowledge')).toBeInTheDocument();
    expect(screen.getByTestId('chat-setting-database')).toBeInTheDocument();
    expect(screen.getByTestId('chat-setting-llm')).toBeInTheDocument();
    expect(screen.getByTestId('chat-setting-agent')).toHaveTextContent('Purpose-built specialists');
    const agent = screen.getByLabelText('Agent');
    expect(agent).toHaveTextContent('General agent');

    await user.click(knowledgeBase);
    expect(screen.getByRole('option', { name: 'testing' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /configs/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /database/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /conversations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /recordings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /outside/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /placeholder/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Knowledge base search'), 'Draft');
    const draftOption = (await screen.findByText('v1 - Draft')).closest('[role="option"]');
    expect(draftOption).not.toBeNull();
    await user.click(draftOption!);
    await user.click(database);
    await user.type(screen.getByLabelText('Database search'), 'anal');
    await user.click(await screen.findByRole('option', { name: 'analytics' }));
    await user.click(model);
    expect(screen.getByText('Workspace default')).toBeInTheDocument();
    expect(screen.getByText('recommended')).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'GPT-5.4' })).toHaveLength(1);
    await user.type(screen.getByLabelText('LLM search'), 'GPT-5.5');
    await user.click(await screen.findByRole('option', { name: 'GPT-5.5' }));

    expect(onContextChange).toHaveBeenCalledWith('/tutorial/context.json', 1);
    expect(onDatabaseChange).toHaveBeenCalledWith('analytics');
    expect(onModelChange).toHaveBeenCalledWith({ providerName: 'openai', model: 'gpt-5.5' });
    expect(model).toHaveTextContent('GPT-5.5');
    expect(trigger).toHaveTextContent('GPT-5.5');
    expect(trigger).not.toHaveTextContent('gpt-5.5');

    await user.click(agent);
    expect(screen.getByRole('option', { name: 'General agent' })).toBeInTheDocument();
    const customAgents = screen.getByRole('option', { name: 'Custom agents' });
    expect(customAgents).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText('Custom agents Coming soon')).toBeInTheDocument();
    await user.click(customAgents);
    expect(agent).toHaveTextContent('General agent');
  });
});
