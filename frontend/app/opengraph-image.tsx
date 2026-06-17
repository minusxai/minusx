import { renderGenericOgImage, OG_SIZE } from '@/lib/og/og-cards';

export const runtime = 'nodejs';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'MinusX — your data stack, staffed by agents';

/** Generic branded MinusX preview card for all non-share pages (`/`, `/login`, …). */
export default async function Image() {
  return renderGenericOgImage();
}
