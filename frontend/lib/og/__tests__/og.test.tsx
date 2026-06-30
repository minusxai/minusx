// Covers the OG share-card stack: pure helpers, image composition (satori + sharp produce
// real PNGs), the public share-image route (serves the stored card, falls back to generic),
// and the share page's server-rendered metadata (incl. no title leak for revoked links).

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { ogCacheKey, truncate, MINUSX_TAGLINE } from '@/lib/og/og-helpers';
import { renderGenericOgImage } from '@/lib/og/og-cards';
import { composeStoryCard } from '@/lib/og/og-image';
import { generateMetadata } from '@/app/l/[shareId]/page';
import { GET as ogRoute } from '@/app/l/[shareId]/og/route';
import { addShare, revokeShare, resolveShare, setStoryPreview, createFile } from '@/lib/data/files.server';
import { createObjectStore } from '@/lib/object-store';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const ADMIN: EffectiveUser = {
  userId: 1, email: 'admin@example.com', name: 'Admin', role: 'admin', home_folder: '/org', mode: 'org',
};

async function makeStory(name: string, description: string | null): Promise<number> {
  for (const path of ['/org/demos', '/org/demos/acme']) {
    await createFile({ type: 'folder', name: path.split('/').pop()!, path, content: {} }, ADMIN);
  }
  const res = await createFile(
    { type: 'story', name, path: '/org/demos/acme/story', content: { description, assets: [], story: '<h1>x</h1>' } },
    ADMIN,
  );
  return res.data.id;
}

const meta = (shareId: string) => generateMetadata({ params: Promise.resolve({ shareId }) });
const renderRoute = (shareId: string) =>
  ogRoute(new Request('http://localhost/') as never, { params: Promise.resolve({ shareId }) });
async function expectPng(res: Response) {
  expect(res.headers.get('content-type')).toContain('image/png');
  expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
}

// A 1×1 JPEG data URL stands in for the client-captured story screenshot.
const SCREENSHOT =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wgARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAUf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==';

describe('og-helpers', () => {
  it('ogCacheKey embeds a sanitized updated_at so edits bust the cache', () => {
    expect(ogCacheKey(42, '2026-06-16T12:00:00.000Z')).toBe('og/42-2026-06-16T120000000Z.png');
    expect(ogCacheKey(42, '2026-06-16T12:00:00.000Z')).not.toBe(ogCacheKey(42, '2026-06-16T13:30:00.000Z'));
  });
  it('ogCacheKey accepts a Date (the pg driver returns TIMESTAMP as Date in prod)', () => {
    // Regression: `t.replace is not a function` 500 on POST /api/files/[id]/preview.
    expect(ogCacheKey(42, new Date('2026-06-16T12:00:00.000Z'))).toBe('og/42-2026-06-16T120000000Z.png');
    // Same instant as a string → same key (cache stays consistent across drivers).
    expect(ogCacheKey(42, new Date('2026-06-16T12:00:00.000Z'))).toBe(ogCacheKey(42, '2026-06-16T12:00:00.000Z'));
  });
  it('truncate leaves short text and ellipsizes long text', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a'.repeat(20), 10)).toHaveLength(10);
  });
});

describe('OG image composition', () => {
  setupTestDb(getTestDbPath('og_compose'));

  it('renders the generic branded card', async () => {
    await expectPng(await renderGenericOgImage());
  });

  it('composes a story card PNG from a screenshot', async () => {
    const buf = await composeStoryCard(SCREENSHOT, 'Q3 Revenue Surge', 'light');
    expect(buf.byteLength).toBeGreaterThan(1000);
  });
});

describe('share opengraph-image route', () => {
  setupTestDb(getTestDbPath('og_route'));

  it('falls back to the generic card for an invalid / un-captured share', async () => {
    await expectPng(await renderRoute('does-not-exist-abcdefghij'));
  });

  it('serves the stored card bytes when present', async () => {
    const id = await makeStory('Stored', 'x');
    const key = ogCacheKey(id, 'testversion');
    const bytes = Buffer.from('PNG-PLACEHOLDER-'.repeat(100)); // >1000 bytes
    await createObjectStore().put(key, bytes, 'image/png');
    await setStoryPreview(id, ADMIN, key);
    const { shareableId } = await addShare(id, ADMIN);

    const res = await renderRoute(shareableId);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(bytes.length);
  });
});

describe('share page generateMetadata', () => {
  setupTestDb(getTestDbPath('og_metadata'));

  it('emits og/twitter tags from the resolved story (share image disabled — no image emitted)', async () => {
    const id = await makeStory('Q3 Revenue Surge', 'How the West drove a 28% jump');
    const { shareableId } = await addShare(id, ADMIN);
    const m = await meta(shareableId);
    expect(m.title).toBe('Q3 Revenue Surge');
    expect(m.description).toBe('How the West drove a 28% jump');
    expect((m.twitter as { card?: string } | undefined)?.card).toBe('summary');
    // Share images are disabled — no og:image / twitter:image should be emitted.
    expect((m.openGraph as { images?: unknown } | undefined)?.images).toBeUndefined();
    expect((m.twitter as { images?: unknown } | undefined)?.images).toBeUndefined();
  });

  it('falls back to the tagline when the story has no description', async () => {
    const id = await makeStory('Untitled', null);
    const { shareableId } = await addShare(id, ADMIN);
    expect((await meta(shareableId)).description).toBe(MINUSX_TAGLINE);
  });

  it('returns empty metadata for invalid and revoked links (no title leak)', async () => {
    expect(await meta('nope-abcdefghij')).toEqual({});
    const id = await makeStory('Secret', 'sensitive');
    const { shareableId } = await addShare(id, ADMIN);
    const resolved = await resolveShare(shareableId);
    await revokeShare(id, ADMIN, resolved!.nonce);
    expect(await meta(shareableId)).toEqual({});
  });
});
