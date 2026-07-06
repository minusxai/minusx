// #4 guard: the conversations (chat) page must preserve ?v=2 on navigation, so
// users in v2 mode stay in v2 when opening or starting a chat. We let the real
// param-preserving useRouter (lib/navigation/use-navigation) run and mock only
// next/navigation's router to capture the final, preserved URL.

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

const { pushSpy } = vi.hoisted(() => ({ pushSpy: vi.fn() }));

// The UI setup globally mocks both next/navigation and the custom use-navigation
// wrapper with no-op routers. Use the REAL use-navigation here (so preserveParams
// runs) and capture the underlying next/navigation push.
vi.mock('@/lib/navigation/use-navigation', async (importOriginal) => await importOriginal());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/conversations',
  useSearchParams: () => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''),
}));

vi.mock('@/lib/hooks/useConversationsList', () => ({
  useConversationsList: () => ({
    conversations: [{ id: 42, name: 'Test chat', updatedAt: new Date().toISOString() }],
    loading: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
  }),
}));

// Type-only import at runtime; mock to avoid loading the server route module.
vi.mock('@/app/api/conversations/route', () => ({}));
vi.mock('@/components/file-browser/Breadcrumb', () => ({ __esModule: true, default: () => null }));

import ConversationsPage from '@/app/conversations/page';

describe('conversations page preserves ?v=2 (#4)', () => {
  beforeEach(() => {
    pushSpy.mockClear();
    window.history.replaceState({}, '', '/conversations?v=2');
  });

  it('opening a chat navigates to /explore/<id>?v=2', async () => {
    const { findByLabelText } = renderWithProviders(<ConversationsPage />);
    fireEvent.click(await findByLabelText('Open conversation: Test chat'));
    expect(pushSpy.mock.calls[0]?.[0]).toBe('/explore/42?v=2');
  });

  it('New Chat preserves v=2', async () => {
    const { findByLabelText } = renderWithProviders(<ConversationsPage />);
    fireEvent.click(await findByLabelText('New chat'));
    expect(pushSpy.mock.calls[0]?.[0]).toBe('/explore?v=2');
  });
});
