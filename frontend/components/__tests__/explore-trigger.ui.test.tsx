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
  default: ({ appState }: { appState?: unknown }) => (
    <div data-testid="explore-chat" data-app-state={JSON.stringify(appState)} />
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
});
