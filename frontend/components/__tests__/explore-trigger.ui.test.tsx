import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ databases: [], availableSkills: [], contextLoading: false }),
}));
vi.mock('@/components/file-browser/Breadcrumb', () => ({ default: () => null }));
vi.mock('@/components/app-shell/RightSidebar', () => ({ default: () => null }));
vi.mock('@/components/app-shell/MobileRightSidebar', () => ({ default: () => null }));
vi.mock('@/components/explore/ChatInterface', () => ({
  default: ({ appState, contextPath, contextVersion, initialAgentName }: {
    appState?: unknown;
    contextPath: string;
    contextVersion?: number;
    initialAgentName?: string | null;
  }) => (
    <div
      data-testid="explore-chat"
      data-app-state={JSON.stringify(appState)}
      data-context-path={contextPath}
      data-context-version={contextVersion}
      data-agent={initialAgentName}
    />
  ),
}));

import ExploreInterface from '@/components/explore/ExploreInterface';

describe('Explore chat trigger attribution', () => {
  it('passes an explicit explore app state to chat', () => {
    renderWithProviders(<ExploreInterface />);

    expect(screen.getByTestId('explore-chat').getAttribute('data-app-state')).toBe(
      JSON.stringify({ type: 'explore', state: null }),
    );
  });

  it('preloads the linked Knowledge Base and custom agent', () => {
    renderWithProviders(
      <ExploreInterface
        initialContextPath="/org/leadership/context.json"
        initialContextVersion={3}
        initialAgentName="ceo_agent"
      />,
    );

    const chat = screen.getByTestId('explore-chat');
    expect(chat).toHaveAttribute('data-context-path', '/org/leadership/context.json');
    expect(chat).toHaveAttribute('data-context-version', '3');
    expect(chat).toHaveAttribute('data-agent', 'ceo_agent');
  });
});
