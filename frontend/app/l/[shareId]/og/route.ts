import { NextRequest } from 'next/server';
import { resolveShare } from '@/lib/data/files.server';
import { createObjectStore } from '@/lib/object-store';
import { renderGenericOgImage } from '@/lib/og/og-cards';

// Public per-share OG image: serves the story's pre-composed card (stored at "make public")
// from the object store, or the generic card when none exists yet. A plain route handler
// (not the opengraph-image file convention) so the share page controls the absolute og:image
// URL itself — the convention only ever emits the dev localhost host. Public via `/l/` bypass.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const resolved = await resolveShare(shareId).catch(() => null);
  const key = (resolved?.file.meta as { preview?: { key?: string } } | null | undefined)?.preview?.key;
  if (key) {
    const buf = await createObjectStore().get(key).catch(() => null);
    if (buf) {
      return new Response(new Uint8Array(buf), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
      });
    }
  }
  return renderGenericOgImage();
}
