// Agents tab of the context editor: read view of saved custom agents, the
// minimal multi-step builder (Identity → Prompt → Skills → Review, save at the
// end), edit prefill, and delete. aria-label queries ONLY (repo rule).

import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { Tabs } from '@chakra-ui/react';
import { AgentsTabContent } from '@/components/context/AgentsTabContent';
import type { AgentEntry, ContextContent } from '@/lib/types';

// Lexical's Markdown round-trip is covered by its own tests. Use a textarea
// here so the builder tests exercise the prompt's controlled wiring directly.
vi.mock('@/components/lexical/LexicalTextEditor', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ initialMarkdown, onChange, ariaLabel }: {
      initialMarkdown: string;
      onChange: (markdown: string) => void;
      ariaLabel?: string;
    }) => React.createElement('textarea', {
      'aria-label': ariaLabel,
      defaultValue: initialMarkdown,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
    }),
  };
});

function mkAgent(overrides: Partial<AgentEntry> & { name: string }): AgentEntry {
  return {
    description: `${overrides.name} description`,
    prompt: 'You are a helpful specialist.',
    promptMode: 'append',
    preloadSkills: [],
    includeSkills: [],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 1,
    ...overrides,
  };
}

const content: ContextContent = {
  published: { all: 1 },
  agents: [mkAgent({ name: 'sales_helper', prompt: 'SALES_PROMPT_BODY', preloadSkills: ['kb_pricing'], includeSkills: ['dashboards'] })],
  fullAgents: [mkAgent({ name: 'inherited_agent' })],
  skills: [{
    name: 'kb_pricing', description: 'pricing kb', content: 'body', enabled: true,
    createdAt: '', updatedAt: '', createdBy: 1,
  }],
};

function renderTab(overrides: Partial<React.ComponentProps<typeof AgentsTabContent>> = {}) {
  const onAddAgent = vi.fn();
  const onStartAddAgent = vi.fn();
  const onUpdateAgent = vi.fn();
  const onDeleteAgent = vi.fn();
  const baseProps: React.ComponentProps<typeof AgentsTabContent> = {
    activeTab: 'picker',
    colorMode: 'light',
    content,
    onChange: vi.fn(),
    canAddAgent: true,
    canManageAgents: true,
    systemSkills: [{ name: 'dashboards', description: 'dash' }, { name: 'alerts', description: 'alerts' }],
    onStartAddAgent,
    onAddAgent,
    onUpdateAgent,
    onDeleteAgent,
    getAgentExploreHref: (agentName) => `/explore?agent=${agentName}&context=%2Forg%2Fcontext.json`,
  };
  const renderContent = (props: Partial<React.ComponentProps<typeof AgentsTabContent>> = {}) => (
    <Tabs.Root value="agents">
      <AgentsTabContent {...baseProps} {...overrides} {...props} />
    </Tabs.Root>
  );
  const rendered = renderWithProviders(renderContent());
  return {
    onAddAgent,
    onStartAddAgent,
    onUpdateAgent,
    onDeleteAgent,
    rerenderTab: (props: Partial<React.ComponentProps<typeof AgentsTabContent>>) => rendered.rerender(renderContent(props)),
  };
}

describe('AgentsTabContent — read view', () => {
  it('renders saved agents as a page of headings with prompt mode, skills, and inherited agents', () => {
    renderTab();
    const card = screen.getByLabelText('Agent sales_helper');
    expect(card).toHaveTextContent('sales_helper');
    expect(card).toHaveTextContent('sales_helper description');
    expect(card).toHaveTextContent('SALES_PROMPT_BODY');
    expect(card).toHaveTextContent(/extends default agent prompt/i);
    expect(card).toHaveTextContent('kb_pricing');   // preloaded skills section
    expect(card).toHaveTextContent('dashboards');   // available skills section
    // inherited agents render read-only
    expect(screen.getByLabelText('Inherited agent inherited_agent')).toBeInTheDocument();
  });

  it('preserves the authored display name and links the play action to Explore', () => {
    renderTab({
      content: {
        ...content,
        agents: [mkAgent({ name: 'ceo_agent', displayName: 'CEO Agent' })],
      },
    });

    const card = screen.getByLabelText('Agent ceo_agent');
    expect(card).toHaveTextContent('CEO Agent');
    expect(card).toHaveTextContent('@ceo_agent');
    expect(screen.getByLabelText('Explore with CEO Agent')).toHaveAttribute(
      'href',
      '/explore?agent=ceo_agent&context=%2Forg%2Fcontext.json',
    );
  });

  it('caps long card instructions with an ellipsis while keeping settings visible', () => {
    const longPrompt = `${'a'.repeat(260)}TAIL_MARKER`;
    renderTab({
      content: {
        ...content,
        agents: [mkAgent({ name: 'long_prompt_agent', prompt: longPrompt, gradeOverride: 'core' })],
      },
    });

    const card = screen.getByLabelText('Agent long_prompt_agent');
    expect(card).toHaveTextContent('…');
    expect(card).not.toHaveTextContent('TAIL_MARKER');
    expect(card).toHaveTextContent(/settings/i);
    expect(card).toHaveTextContent(/core model/i);
  });

  it('keeps skill chips to two rows and summarizes the remainder', () => {
    renderTab({
      content: {
        ...content,
        agents: [mkAgent({
          name: 'skill_heavy_agent',
          preloadSkills: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
        })],
      },
    });

    const card = screen.getByLabelText('Agent skill_heavy_agent');
    expect(card).toHaveTextContent('one');
    expect(card).toHaveTextContent('six');
    expect(card).not.toHaveTextContent('seven');
    expect(card).toHaveTextContent('+3 more');
  });

  it('does not repeat an always-loaded skill in the on-demand list', () => {
    renderTab({
      content: {
        ...content,
        agents: [mkAgent({
          name: 'deduped_agent',
          preloadSkills: ['questions'],
          includeSkills: ['questions', 'dashboards'],
        })],
      },
    });

    const cardText = screen.getByLabelText('Agent deduped_agent').textContent ?? '';
    expect(cardText.match(/questions/g)).toHaveLength(1);
    expect(cardText).toContain('dashboards');
  });

  it('shows no available or preloaded skills when both selections are empty', () => {
    renderTab({
      content: {
        ...content,
        agents: [mkAgent({ name: 'empty_agent', preloadSkills: [], includeSkills: [] })],
      },
    });

    const card = screen.getByLabelText('Agent empty_agent');
    expect(card).not.toHaveTextContent('Full catalog');
    expect(card.textContent?.match(/None/g)).toHaveLength(2);
  });
});

describe('AgentsTabContent — builder', () => {
  it('walks Identity → Prompt → Skills → Review and saves a well-formed draft at the end', () => {
    const { onAddAgent, onStartAddAgent } = renderTab();
    fireEvent.click(screen.getByLabelText('Add agent'));
    expect(onStartAddAgent).toHaveBeenCalledTimes(1);

    // Step 1: Identity
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Growth Guru' } });
    fireEvent.change(screen.getByLabelText('Agent description'), { target: { value: 'Growth specialist' } });
    fireEvent.click(screen.getByLabelText('Builder next'));

    // Step 2: Prompt
    fireEvent.change(screen.getByLabelText('Agent prompt'), { target: { value: 'GROWTH_PROMPT' } });
    fireEvent.click(screen.getByLabelText('Prompt mode replace'));
    fireEvent.click(screen.getByLabelText('Builder next'));

    // Step 3: Skills — preload a user skill, include a system skill
    fireEvent.click(screen.getByLabelText('Preload skill kb_pricing'));
    fireEvent.click(screen.getByLabelText('Include skill dashboards'));
    fireEvent.click(screen.getByLabelText('Builder next'));

    // Step 4: Review shows the read view; nothing saved yet
    expect(screen.getByLabelText('Agent review')).toHaveTextContent('GROWTH_PROMPT');
    expect(onAddAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Save agent'));
    expect(onAddAgent).toHaveBeenCalledTimes(1);
    const draft = onAddAgent.mock.calls[0][0];
    expect(draft).toMatchObject({
      name: 'growth_guru',
      displayName: 'Growth Guru',
      description: 'Growth specialist',
      prompt: 'GROWTH_PROMPT',
      promptMode: 'replace',
      preloadSkills: ['kb_pricing'],
      includeSkills: ['dashboards'],
    });
  });

  it('blocks stepping past Identity without a name and past Prompt without a prompt', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('Add agent'));
    // no name yet → Next disabled
    expect(screen.getByLabelText('Builder next')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'x_bot' } });
    fireEvent.click(screen.getByLabelText('Builder next'));
    // empty prompt → Next disabled on the prompt step
    expect(screen.getByLabelText('Builder next')).toBeDisabled();
  });

  it('treats an empty skill selection as zero on-demand and zero preloaded', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('Add agent'));
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Empty Agent' } });
    fireEvent.click(screen.getByLabelText('Builder next'));
    fireEvent.change(screen.getByLabelText('Agent prompt'), { target: { value: 'Stay focused.' } });
    fireEvent.click(screen.getByLabelText('Builder next'));

    expect(screen.getByText('0 on demand')).toBeInTheDocument();
    expect(screen.getByText('0 always loaded')).toBeInTheDocument();
    expect(screen.queryByText(/Full catalog/i)).not.toBeInTheDocument();
  });

  it('prefills the builder when editing, and saves via onUpdateAgent', () => {
    const { onUpdateAgent } = renderTab();
    fireEvent.click(screen.getByLabelText('Edit agent sales_helper'));
    expect(screen.getByLabelText('Agent name')).toHaveValue('Sales Helper');
    fireEvent.click(screen.getByLabelText('Builder next'));
    expect(screen.getByLabelText('Agent prompt')).toHaveValue('SALES_PROMPT_BODY');
    fireEvent.click(screen.getByLabelText('Builder next'));
    fireEvent.click(screen.getByLabelText('Builder next'));
    fireEvent.click(screen.getByLabelText('Save agent'));
    expect(onUpdateAgent).toHaveBeenCalledTimes(1);
    expect(onUpdateAgent.mock.calls[0][0]).toBe(0); // index of sales_helper
    expect(onUpdateAgent.mock.calls[0][1]).toMatchObject({ name: 'sales_helper', displayName: 'Sales Helper' });
  });

  it('edits Published/Draft status inside the builder without saving early', async () => {
    const user = userEvent.setup();
    const { onUpdateAgent } = renderTab();
    fireEvent.click(screen.getByLabelText('Edit agent sales_helper'));

    const published = screen.getByLabelText('Agent published');
    expect(published).toBeChecked();
    await user.click(published);
    expect(published).not.toBeChecked();
    expect(onUpdateAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Builder step Review'));
    fireEvent.click(screen.getByLabelText('Save agent'));
    expect(onUpdateAgent).toHaveBeenCalledWith(0, expect.objectContaining({ enabled: false }));
  });

  it('deletes an agent', () => {
    const { onDeleteAgent } = renderTab();
    fireEvent.click(screen.getByLabelText('Delete agent sales_helper'));
    expect(onDeleteAgent).toHaveBeenCalledWith(0);
  });

  it('toggles an agent between published (enabled) and draft (disabled) via a switch', async () => {
    const user = userEvent.setup();
    const { onUpdateAgent } = renderTab();
    const card = screen.getByLabelText('Agent sales_helper');
    expect(card).toHaveTextContent(/published/i); // enabled agent shows Published
    const toggle = screen.getByLabelText('Agent sales_helper enabled');
    expect(toggle).toBeChecked(); // an actual switch input, not a button
    await user.click(toggle);
    expect(onUpdateAgent).toHaveBeenCalledWith(0, { enabled: false });
  });

  it('shows a Draft label for a disabled agent', () => {
    renderTab({
      content: {
        ...content,
        agents: [mkAgent({ name: 'sales_helper', enabled: false })],
      },
    });
    expect(screen.getByLabelText('Agent sales_helper')).toHaveTextContent(/draft/i);
  });

  it('has no emoji field (avatars may come later)', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('Add agent'));
    expect(screen.queryByLabelText('Agent emoji')).not.toBeInTheDocument();
  });

  it('lets an editor jump directly to a section via the step tabs', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('Edit agent sales_helper'));
    // jump straight to Skills, no next/next
    fireEvent.click(screen.getByLabelText('Builder step Skills'));
    expect(screen.getByLabelText('Preload skill kb_pricing')).toBeInTheDocument();
    // and back to Prompt
    fireEvent.click(screen.getByLabelText('Builder step Prompt'));
    expect(screen.getByLabelText('Agent prompt')).toHaveValue('SALES_PROMPT_BODY');
  });

  it('labels skill provenance and filters the skill card catalog', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('Edit agent sales_helper'));
    fireEvent.click(screen.getByLabelText('Builder step Skills'));

    expect(screen.getByLabelText('Skill kb_pricing')).toHaveTextContent('User skill');
    expect(screen.getByLabelText('Skill dashboards')).toHaveTextContent('System skill');

    fireEvent.change(screen.getByLabelText('Search skills'), { target: { value: 'alerts' } });
    expect(screen.getByLabelText('Skill alerts')).toBeInTheDocument();
    expect(screen.queryByLabelText('Skill dashboards')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Skill kb_pricing')).not.toBeInTheDocument();
  });

  it('keeps On demand and Always loaded mutually exclusive', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('Edit agent sales_helper'));
    fireEvent.click(screen.getByLabelText('Builder step Skills'));

    expect(screen.getByLabelText('Include skill dashboards')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByLabelText('Preload skill dashboards'));
    expect(screen.getByLabelText('Include skill dashboards')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText('Preload skill dashboards')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByLabelText('Exclude skill dashboards'));
    expect(screen.getByLabelText('Exclude skill dashboards')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Include skill dashboards')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText('Preload skill dashboards')).toHaveAttribute('aria-checked', 'false');
  });

  it('blocks jumping ahead while prerequisites are missing (new agent)', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('Add agent'));
    // no name yet → later steps unreachable
    expect(screen.getByLabelText('Builder step Review')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'x_bot' } });
    // name set but no prompt → Prompt reachable, Review still not
    expect(screen.getByLabelText('Builder step Prompt')).not.toBeDisabled();
    expect(screen.getByLabelText('Builder step Review')).toBeDisabled();
  });

  it('hides management controls when the user cannot manage agents', () => {
    renderTab({ canAddAgent: false, canManageAgents: false });
    expect(screen.queryByLabelText('Add agent')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit agent sales_helper')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete agent sales_helper')).not.toBeInTheDocument();
  });

  it('shows Add agent before edit mode while keeping edit and delete controls hidden', () => {
    const { onStartAddAgent } = renderTab({ canAddAgent: true, canManageAgents: false });

    expect(screen.getByLabelText('Add agent')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit agent sales_helper')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete agent sales_helper')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Add agent'));
    expect(onStartAddAgent).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Agent name')).toBeInTheDocument();
  });

  it('dismisses the nested builder when the page exits edit mode', () => {
    const { rerenderTab } = renderTab();
    fireEvent.click(screen.getByLabelText('Edit agent sales_helper'));
    expect(screen.getByLabelText('Agent name')).toBeInTheDocument();

    rerenderTab({ canManageAgents: false });

    expect(screen.queryByLabelText('Agent name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Agent sales_helper')).toBeInTheDocument();
  });
});
