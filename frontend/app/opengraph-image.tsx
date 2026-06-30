import { renderGenericOgImage, OG_SIZE } from '@/lib/og/og-cards';

export const runtime = 'nodejs';
// Render per request, not at build time. The card is built from the request-scoped
// branding config; baking it statically would freeze the default-brand card and ignore
// any configured logo. (Matches the per-share OG route, which is also force-dynamic.)
export const dynamic = 'force-dynamic';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Social preview card';

/** Generic branded MinusX preview card for all non-share pages (`/`, `/login`, …). */
export default async function Image() {
  return renderGenericOgImage();
}
