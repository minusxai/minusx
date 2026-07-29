// Regression: the floating "Ask anything" bar is a small centered pill, but its
// fixed full-width wrapper row re-enabled pointer-events on the whole row — so
// the page content beside the pill (the entire horizontal strip) was unclickable.
// Contract: only the pill itself is interactive; every full-width wrapper between
// it and the fixed-position root lets clicks pass through (pointer-events: none).

vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: vi.fn(), isBlocked: false, confirmNavigation: vi.fn(), cancelNavigation: vi.fn() }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: { branding: { agentName: 'TestBot' } },
  }),
}));

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({
    databases: [],
    availableSkills: [],
    agents: [],
  }),
}));

vi.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: vi.fn().mockResolvedValue({ text: '', wordCount: 0 }),
  SUPPORTED_DOC_EXTENSIONS: '.pdf,.docx,.txt',
}));

vi.mock('@/lib/object-store/client', () => ({
  uploadFile: vi.fn(),
}));

vi.mock('@/components/Markdown', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', { 'data-testid': 'markdown' }, children),
  };
});

vi.mock('@/components/chat/LexicalMentionEditor', () => {
  const React = require('react');
  return {
    __esModule: true,
    LexicalMentionEditor: React.forwardRef(function MockLexicalMentionEditor(_props: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ clear: vi.fn(), setText: vi.fn(), focus: vi.fn() }));
      return React.createElement('textarea', { 'aria-label': 'Chat editor' });
    }),
  };
});

import React from 'react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import FloatingChatWrapper from '@/components/app-shell/FloatingChatWrapper';
import ShareFloatingChat from '@/components/share/ShareFloatingChat';

/**
 * Walks from the pill outward and asserts the pass-through contract:
 * the pill's width-constrained wrapper is interactive, and everything
 * above it up to the fixed-position root ignores pointer events.
 */
function assertRowLetsClicksThrough(container: HTMLElement) {
  const pill = container.querySelector('[data-collapsed]') as HTMLElement | null;
  expect(pill).not.toBeNull();

  const bar = pill!.parentElement as HTMLElement;
  expect(getComputedStyle(bar).pointerEvents).toBe('auto');

  let el = bar.parentElement;
  let sawFixedRoot = false;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    expect(cs.pointerEvents).toBe('none');
    if (cs.position === 'fixed') {
      sawFixedRoot = true;
      break;
    }
    el = el.parentElement;
  }
  expect(sawFixedRoot).toBe(true);
}

describe('floating chat bar: click pass-through beside the pill', () => {
  it('FloatingChatWrapper row does not swallow clicks outside the pill', () => {
    const store = storeModule.makeStore();
    const { container } = renderWithProviders(<FloatingChatWrapper appState={null} />, { store });
    assertRowLetsClicksThrough(container);
  });

  it('ShareFloatingChat row does not swallow clicks outside the pill', () => {
    const store = storeModule.makeStore();
    const { container } = renderWithProviders(
      <ShareFloatingChat contextPath="/" appState={null} railWidth="49px" onOpenChat={vi.fn()} />,
      { store },
    );
    assertRowLetsClicksThrough(container);
  });
});
