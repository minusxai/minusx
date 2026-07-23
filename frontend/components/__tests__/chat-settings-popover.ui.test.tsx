import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { setUser } from '@/store/authSlice';
import type { LlmGrade } from '@/lib/llm/llm-config-types';

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
          defaultGrade: 'core',
          grades: [
            { grade: 'lite', configured: false },
            { grade: 'core', configured: true },
            { grade: 'advanced', configured: true },
          ],
        },
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps one stable summary trigger and offers grades (not raw models) in one click-only panel', async () => {
    const user = userEvent.setup();
    const onDatabaseChange = vi.fn();
    const onGradeChange = vi.fn();
    const onContextChange = vi.fn();
    function StatefulPopover() {
      const [selectedGrade, setSelectedGrade] = React.useState<LlmGrade | null>(null);
      return (
        <ChatSettingsPopover
          databaseName="warehouse"
          onDatabaseChange={onDatabaseChange}
          selectedGrade={selectedGrade}
          onGradeChange={(grade) => {
            setSelectedGrade(grade);
            onGradeChange(grade);
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
    expect(trigger).toHaveTextContent('Analyst agent');
    // Default grade summarized by its grade name, not a raw model id.
    await waitFor(() => expect(trigger).toHaveTextContent('Core'));
    expect(trigger).toHaveTextContent(/warehouse.*Analyst agent.*Core/);
    expect(screen.queryByLabelText('Database')).not.toBeInTheDocument();

    await user.click(trigger);

    expect(screen.getByText('Configure this chat')).toBeInTheDocument();
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
    expect(agent).toHaveTextContent('Analyst agent');

    await user.click(knowledgeBase);
    expect(screen.getByRole('option', { name: 'testing' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /outside/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Knowledge base search'), 'Draft');
    const draftOption = (await screen.findByText('v1 - Draft')).closest('[role="option"]');
    expect(draftOption).not.toBeNull();
    await user.click(draftOption!);
    await user.click(database);
    await user.type(screen.getByLabelText('Database search'), 'anal');
    await user.click(await screen.findByRole('option', { name: 'analytics' }));

    await user.click(model);
    // GRADES ONLY: the picker shows grade names + when-to-use descriptions —
    // no provider names or model ids ever (behind-the-scenes concerns).
    expect(screen.getByText('Workspace default')).toBeInTheDocument();
    expect(screen.getByText('recommended')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Core/ })).toHaveTextContent(/optimized for most tasks/i);
    expect(screen.getByRole('option', { name: /Advanced/ })).toHaveTextContent(/more powerful/i);
    expect(screen.queryByText(/claude/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/anthropic/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/gpt/i)).not.toBeInTheDocument();
    // An unconfigured grade is visible but not selectable.
    const liteOption = screen.getByRole('option', { name: /Lite/ });
    expect(liteOption).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: /Advanced/ }));

    expect(onContextChange).toHaveBeenCalledWith('/tutorial/context.json', 1);
    expect(onDatabaseChange).toHaveBeenCalledWith('analytics');
    expect(onGradeChange).toHaveBeenCalledWith('advanced');
    expect(model).toHaveTextContent('Advanced');
    expect(trigger).toHaveTextContent('Advanced');

    // Re-selecting the workspace default clears the override (null).
    await user.click(model);
    await user.click(screen.getByRole('option', { name: /Core/ }));
    expect(onGradeChange).toHaveBeenLastCalledWith(null);
    expect(trigger).toHaveTextContent('Core');

    await user.click(agent);
    expect(screen.getByRole('option', { name: 'Analyst agent' })).toBeInTheDocument();
    const customAgents = screen.getByRole('option', { name: 'Specialized agents' });
    expect(customAgents).toHaveAttribute('aria-disabled', 'true');
    await user.click(customAgents);
    expect(agent).toHaveTextContent('Analyst agent');
  });

  // The workspace default is the grade every chat actually runs on. Badging it
  // "recommended" while it resolves to nothing tells the user the one option
  // they're allowed to use is fine, right before the turn errors.
  it('does not badge the workspace default as recommended when it is unconfigured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          defaultGrade: 'core',
          grades: [
            { grade: 'core', configured: false },
            { grade: 'advanced', configured: false },
          ],
        },
      }),
    }));
    const user = userEvent.setup();
    renderWithProviders(
      <ChatSettingsPopover
        databaseName="warehouse"
        onDatabaseChange={vi.fn()}
        selectedGrade={null}
        onGradeChange={vi.fn()}
        selectedContextPath="/tutorial/context.json"
        selectedVersion={2}
        onContextChange={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText('Chat settings'));
    await user.click(await screen.findByLabelText('LLM'));

    expect(screen.queryByText('recommended')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Core/ })).toHaveTextContent(/not configured/i);
  });
});
