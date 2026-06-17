import { renderShareOgImage, OG_SIZE } from '@/lib/og/og-image';

// resvg/sharp (chart render) are native — must run on the Node runtime.
export const runtime = 'nodejs';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'MinusX data story';

/**
 * Social-preview image for a public share. Renders a designed card with the story's
 * title + hero chart, or the generic MinusX card for a dead/revoked link. The URL lives
 * under `/l/...`, so it inherits the public middleware bypass — no auth required.
 */
export default async function Image({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  return renderShareOgImage(shareId);
}
