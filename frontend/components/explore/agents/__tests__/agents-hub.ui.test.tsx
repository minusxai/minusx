/**
 * AgentsHub grid: preset agents render, Launch activates an agent,
 * gear opens the wizard prefilled with that agent's config.
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

describe('AgentsHub', () => {
  it('renders a card for every preset agent', async () => {
    renderWithProviders(<AgentsHub />);

    expect(await screen.findByLabelText('Launch CEO Agent')).toBeInTheDocument();
    expect(screen.getByLabelText('Launch CFO Agent')).toBeInTheDocument();
    expect(screen.getByLabelText('Launch Growth Agent')).toBeInTheDocument();
    expect(screen.getByLabelText('Launch Ops Agent')).toBeInTheDocument();
    expect(screen.getByLabelText('Launch Data Quality Agent')).toBeInTheDocument();
    expect(screen.getByLabelText('Launch Marketing Agent')).toBeInTheDocument();
    expect(screen.getByLabelText('Create agent')).toBeInTheDocument();
  });

  it('sets the active agent when Launch is clicked', async () => {
    const { store } = renderWithProviders(<AgentsHub />);

    fireEvent.click(await screen.findByLabelText('Launch CEO Agent'));

    expect(store.getState().agents.activeAgentSlug).toBe('ceo-agent');
  });

  it('opens the wizard prefilled when the gear is clicked', async () => {
    renderWithProviders(<AgentsHub />);

    fireEvent.click(await screen.findByLabelText('Configure CFO Agent'));

    const nameInput = await screen.findByLabelText('Agent name');
    expect((nameInput as HTMLInputElement).value).toBe('CFO Agent');
  });
});
