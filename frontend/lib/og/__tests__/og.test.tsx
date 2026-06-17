// Covers the OG share-card stack: pure helpers, image composition (satori + sharp produce
// real PNGs), and the share page's server-rendered metadata (og:image from the stored card,
// and no title leak for revoked links).

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

const meta = (shareId: string) => generateMetadata({ params: Promise.resolve({ shareId }) });

// A 1×1 JPEG data URL stands in for the client-captured story screenshot.
const SCREENSHOT =
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

describe('OG image composition', () => {
  setupTestDb(getTestDbPath('og_compose'));

  it('renders the generic branded card', async () => {
    const res = await renderGenericOgImage();
    expect(res.headers.get('content-type')).toContain('image/png');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('composes a story card PNG from a screenshot', async () => {
    const buf = await composeStoryCard(SCREENSHOT, 'Q3 Revenue Surge', 'light');
    expect(buf.byteLength).toBeGreaterThan(1000);
  });
});

describe('share page generateMetadata', () => {
  setupTestDb(getTestDbPath('og_metadata'));

  it('sets og:image to the stored card and emits og/twitter tags', async () => {
    const id = await makeStory('Q3 Revenue Surge', 'How the West drove a 28% jump');
    await setStoryPreview(id, ADMIN, 'https://cdn.example.com/og/card.png');
    const { shareableId } = await addShare(id, ADMIN);

    const m = await meta(shareableId);
    expect(m.title).toBe('Q3 Revenue Surge');
    expect((m.openGraph as { images?: string[] } | undefined)?.images).toEqual(['https://cdn.example.com/og/card.png']);
    expect((m.twitter as { card?: string } | undefined)?.card).toBe('summary_large_image');
  });

  it('omits images (inherits generic) when no card is stored, and uses the tagline with no description', async () => {
    const id = await makeStory('Untitled', null);
    const { shareableId } = await addShare(id, ADMIN);
    const m = await meta(shareableId);
    expect(m.description).toBe(MINUSX_TAGLINE);
    expect((m.openGraph as { images?: string[] } | undefined)?.images).toBeUndefined();
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
