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
  renderWithProviders(
    <Tabs.Root value="agents">
      <AgentsTabContent
        activeTab="picker"
        colorMode="light"
        content={content}
        onChange={vi.fn()}
        canAddAgent={true}
        canManageAgents={true}
        systemSkills={[{ name: 'dashboards', description: 'dash' }, { name: 'alerts', description: 'alerts' }]}
        onStartAddAgent={onStartAddAgent}
        onAddAgent={onAddAgent}
        onUpdateAgent={onUpdateAgent}
        onDeleteAgent={onDeleteAgent}
        {...overrides}
      />
    </Tabs.Root>,
  );
  return { onAddAgent, onStartAddAgent, onUpdateAgent, onDeleteAgent };
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
          preloadSkills: ['one', 'two', 'three', 'four', 'five', 'six'],
        })],
      },
    });

    const card = screen.getByLabelText('Agent skill_heavy_agent');
    expect(card).toHaveTextContent('one');
    expect(card).toHaveTextContent('three');
    expect(card).not.toHaveTextContent('four');
    expect(card).toHaveTextContent('+3 more');
  });
});

describe('AgentsTabContent — builder', () => {
  it('walks Identity → Prompt → Skills → Review and saves a well-formed draft at the end', () => {
    const { onAddAgent, onStartAddAgent } = renderTab();
    fireEvent.click(screen.getByLabelText('Add agent'));
    expect(onStartAddAgent).toHaveBeenCalledTimes(1);

    // Step 1: Identity
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'growth_guru' } });
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

  it('prefills the builder when editing, and saves via onUpdateAgent', () => {
    const { onUpdateAgent } = renderTab();
    fireEvent.click(screen.getByLabelText('Edit agent sales_helper'));
    expect(screen.getByLabelText('Agent name')).toHaveValue('sales_helper');
    fireEvent.click(screen.getByLabelText('Builder next'));
    expect(screen.getByLabelText('Agent prompt')).toHaveValue('SALES_PROMPT_BODY');
    fireEvent.click(screen.getByLabelText('Builder next'));
    fireEvent.click(screen.getByLabelText('Builder next'));
    fireEvent.click(screen.getByLabelText('Save agent'));
    expect(onUpdateAgent).toHaveBeenCalledTimes(1);
    expect(onUpdateAgent.mock.calls[0][0]).toBe(0); // index of sales_helper
    expect(onUpdateAgent.mock.calls[0][1]).toMatchObject({ name: 'sales_helper' });
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
});
