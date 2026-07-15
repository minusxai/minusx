/**
 * AgentWizardModal: 4-step creation flow with step indicator,
 * Next gating on name, Back navigation, and Publish upserting into the store.
 */

vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
}));

import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import AgentsHub from '@/components/explore/agents/AgentsHub';

async function openCreateWizard() {
  fireEvent.click(await screen.findByLabelText('Create agent'));
  await screen.findByLabelText('Agent name');
}

describe('AgentWizardModal', () => {
  it('disables Next until a name is entered, then walks all four steps and back', async () => {
    renderWithProviders(<AgentsHub />);
    await openCreateWizard();

    expect(screen.getByLabelText('Step 1 of 4')).toBeInTheDocument();
    const next = screen.getByLabelText('Next step');
    expect(next).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Support Agent' } });
    expect(next).not.toBeDisabled();

    // Step 2: prompt (prefilled from template)
    fireEvent.click(next);
    expect(screen.getByLabelText('Step 2 of 4')).toBeInTheDocument();
    const prompt = screen.getByLabelText('System prompt') as HTMLTextAreaElement;
    expect(prompt.value).toContain('Support Agent');

    // Step 3: capabilities
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByLabelText('Step 3 of 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Tool: SQL Query Engine')).toBeInTheDocument();
    expect(screen.getByLabelText('Skill: Forecasting')).toBeInTheDocument();

    // Step 4: review
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByLabelText('Step 4 of 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Publish agent')).toBeInTheDocument();

    // Back returns to step 3
    fireEvent.click(screen.getByLabelText('Back'));
    expect(screen.getByLabelText('Step 3 of 4')).toBeInTheDocument();
  });

  it('publishes a new agent into the store', async () => {
    const { store } = renderWithProviders(<AgentsHub />);
    await openCreateWizard();

    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Support Agent' } });
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Tool: Web Research'));
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Publish agent'));

    const agents = store.getState().agents.agents;
    const created = agents.find(a => a.name === 'Support Agent');
    expect(created).toBeDefined();
    expect(created?.preset).toBeFalsy();
    expect(created?.tools).toContain('web');
  });

  it('publishing from the gear updates the existing agent instead of adding a new one', async () => {
    const { store } = renderWithProviders(<AgentsHub />);
    const countBefore = store.getState().agents.agents.length;

    fireEvent.click(await screen.findByLabelText('Configure CFO Agent'));
    await screen.findByLabelText('Agent name');

    fireEvent.change(screen.getByLabelText('Agent description'), { target: { value: 'Updated finance copilot.' } });
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Publish agent'));

    const agents = store.getState().agents.agents;
    expect(agents.length).toBe(countBefore);
    expect(agents.find(a => a.slug === 'cfo-agent')?.description).toBe('Updated finance copilot.');
  });
});
