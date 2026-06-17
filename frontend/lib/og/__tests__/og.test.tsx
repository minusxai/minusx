// Covers the OG share-card stack: pure helpers, the cover/generic image rendering
// (satori + sharp produce real PNGs), and the share page's server-rendered metadata
// (incl. no title leak for revoked links).

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { ogCacheKey, truncate, MINUSX_TAGLINE } from '@/lib/og/og-helpers';
import { renderGenericOgImage, renderShareOgImage } from '@/lib/og/og-image';
import { generateMetadata } from '@/app/l/[shareId]/page';
import { addShare, revokeShare, resolveShare, setStoryPreview, createFile } from '@/lib/data/files.server';
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

async function expectPng(res: Response) {
  expect(res.headers.get('content-type')).toContain('image/png');
  expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
}

// A 1×1 JPEG data URL stands in for the client-captured story screenshot.
const COVER =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wgARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAUf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==';

describe('og-helpers', () => {
  it('ogCacheKey embeds a sanitized updated_at so edits bust the cache', () => {
    expect(ogCacheKey(42, '2026-06-16T12:00:00.000Z')).toBe('og/42-2026-06-16T120000000Z.png');
    expect(ogCacheKey(42, '2026-06-16T12:00:00.000Z')).not.toBe(ogCacheKey(42, '2026-06-16T13:30:00.000Z'));
  });
  it('truncate leaves short text and ellipsizes long text', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a'.repeat(20), 10)).toHaveLength(10);
  });
});

describe('OG image rendering', () => {
  setupTestDb(getTestDbPath('og_image'));

  it('renders the generic branded card', async () => {
    await expectPng(await renderGenericOgImage());
  });

  it('falls back to the generic card for an invalid share', async () => {
    await expectPng(await renderShareOgImage('does-not-exist-abcdefghij'));
  });

  it('falls back to the generic card for a story with no captured cover', async () => {
    const id = await makeStory('Uncaptured', 'no cover yet');
    const { shareableId } = await addShare(id, ADMIN);
    await expectPng(await renderShareOgImage(shareableId));
  });

  it('renders the cover card once a preview is stored', async () => {
    const id = await makeStory('Covered Story', 'has a cover');
    await setStoryPreview(id, ADMIN, COVER);
    const { shareableId } = await addShare(id, ADMIN);
    await expectPng(await renderShareOgImage(shareableId));
  });
});

describe('share page generateMetadata', () => {
  setupTestDb(getTestDbPath('og_metadata'));

  it('emits og/twitter tags from the resolved story', async () => {
    const id = await makeStory('Q3 Revenue Surge', 'How the West drove a 28% jump');
    const { shareableId } = await addShare(id, ADMIN);
    const meta = await generateMetadata({ params: Promise.resolve({ shareId: shareableId }) });
    expect(meta.title).toBe('Q3 Revenue Surge');
    expect(meta.description).toBe('How the West drove a 28% jump');
    expect((meta.twitter as { card?: string } | undefined)?.card).toBe('summary_large_image');
  });

  it('falls back to the tagline when the story has no description', async () => {
    const id = await makeStory('Untitled', null);
    const { shareableId } = await addShare(id, ADMIN);
    const meta = await generateMetadata({ params: Promise.resolve({ shareId: shareableId }) });
    expect(meta.description).toBe(MINUSX_TAGLINE);
  });

  it('returns empty metadata for invalid and revoked links (no title leak)', async () => {
    expect(await generateMetadata({ params: Promise.resolve({ shareId: 'nope-abcdefghij' }) })).toEqual({});
    const id = await makeStory('Secret', 'sensitive');
    const { shareableId } = await addShare(id, ADMIN);
    const resolved = await resolveShare(shareableId);
    await revokeShare(id, ADMIN, resolved!.nonce);
    expect(await generateMetadata({ params: Promise.resolve({ shareId: shareableId }) })).toEqual({});
  });
});
