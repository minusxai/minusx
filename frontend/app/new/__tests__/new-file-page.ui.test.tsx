/**
 * /new/[type] — the draft-creation redirect page.
 *
 * The Create menu (and Navigate tool) link to `/new/question?folder=/org/tester`.
 * This page must forward that `folder` to createDraftFile so the draft lands in the
 * folder the user was browsing — not in the user's home folder.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

const h = vi.hoisted(() => ({
  drafts: [] as { type: string; opts: Record<string, unknown> }[],
  search: '',
  replaced: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/new/question',
  useSearchParams: () => new URLSearchParams(h.search),
  notFound: () => { throw new Error('notFound'); },
}));

vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: (url: string) => { h.replaced.push(url); },
    back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(),
  }),
  getRouter: vi.fn(() => null),
}));

vi.mock('@/lib/file-state/file-state', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createDraftFile: vi.fn(async (type: string, opts: Record<string, unknown>) => {
    h.drafts.push({ type, opts });
    return 1062;
  }),
}));

import NewFilePage from '../[type]/page';

// The page `use()`s its params promise, which suspends on first render — it needs a
// boundary, and an `act` flush for React to pick the resolved promise back up.
async function renderNewFilePage(type: string) {
  await act(async () => {
    renderWithProviders(
      <React.Suspense fallback={null}>
        <NewFilePage params={Promise.resolve({ type })} />
      </React.Suspense>
    );
  });
}

beforeEach(() => {
  h.drafts.length = 0;
  h.replaced.length = 0;
  h.search = '';
});

describe('/new/[type] draft creation', () => {
  it('allows a notebook draft through the direct /new/notebook route', async () => {
    await renderNewFilePage('notebook');

    await waitFor(() => expect(h.drafts).toHaveLength(1));
    expect(h.drafts[0].type).toBe('notebook');
  });

  it('forwards the folder search param to createDraftFile', async () => {
    h.search = `?folder=${encodeURIComponent('/org/tester')}`;
    await renderNewFilePage('question');

    await waitFor(() => expect(h.drafts).toHaveLength(1));
    expect(h.drafts[0].type).toBe('question');
    expect(h.drafts[0].opts.folder).toBe('/org/tester');
  });

  it('leaves folder undefined when no folder param is present (home-folder default)', async () => {
    await renderNewFilePage('question');

    await waitFor(() => expect(h.drafts).toHaveLength(1));
    expect(h.drafts[0].opts.folder).toBeUndefined();
  });

  it('still forwards databaseName and the decoded query alongside the folder', async () => {
    const sql = 'SELECT 1';
    const queryB64 = Buffer.from(sql, 'utf-8').toString('base64');
    h.search = `?folder=${encodeURIComponent('/org/tester')}&databaseName=duck&queryB64=${queryB64}`;
    await renderNewFilePage('question');

    await waitFor(() => expect(h.drafts).toHaveLength(1));
    expect(h.drafts[0].opts).toMatchObject({
      folder: '/org/tester',
      databaseName: 'duck',
      query: sql,
    });
  });

  it('redirects to the created file', async () => {
    h.search = `?folder=${encodeURIComponent('/org/tester')}`;
    await renderNewFilePage('question');

    await waitFor(() => expect(h.replaced).toHaveLength(1));
    expect(h.replaced[0]).toContain('/f/1062');
  });
});
