/**
 * Compose a story's social-share card (server-only): blur the captured story screenshot,
 * then overlay the title + brand mark via the cover card. Called once when a story is made
 * public; the composed PNG is uploaded and stored, then served directly as og:image — there
 * is no on-crawl rendering. Imports next/og + sharp, so only the preview route uses this.
 */
import 'server-only';
import sharp from 'sharp';
import { StoryCoverCard, imageResponse, loadCardAssets, type CoverTone, type CardAssets } from '@/lib/og/og-cards';

/** Pre-blur the screenshot (satori can't do CSS blur), tone-matched so the frost reads well. */
async function blurScreenshot(screenshot: string, tone: CoverTone): Promise<string> {
  let input: Buffer;
  if (screenshot.startsWith('data:')) {
    input = Buffer.from(screenshot.slice(screenshot.indexOf(',') + 1), 'base64');
  } else {
    const ab = (await fetch(screenshot).then((r) => r.arrayBuffer())) as ArrayBuffer;
    input = Buffer.from(new Uint8Array(ab));
  }
  const brightness = tone === 'light' ? 1.12 : 0.85;
  // Intentionally NOT AGENT_IMAGE_JPEG_QUALITY: this is a heavily blurred decorative backdrop for
  // the OG card, so a lower quality is fine and keeps the card small.
  const out = await sharp(input).blur(5).modulate({ brightness }).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

/** Compose the final 1200×630 card PNG from a story screenshot (data URL or remote URL). */
export async function composeStoryCard(
  screenshot: string,
  title: string,
  tone: CoverTone,
  assets?: CardAssets,
): Promise<Buffer> {
  const cardAssets = assets ?? (await loadCardAssets());
  const blurred = await blurScreenshot(screenshot, tone);
  const res = imageResponse(<StoryCoverCard coverUrl={blurred} title={title} tone={tone} assets={cardAssets} />);
  return Buffer.from(await res.arrayBuffer());
}
