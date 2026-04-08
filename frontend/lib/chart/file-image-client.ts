/**
 * Frontend file → image URL via DOM capture.
 *
 * Captures the rendered [data-file-id] element (exact visual match to what
 * the user sees), uploads to S3, and returns the public URL.
 *
 * Works for all viz types: chart, table, pivot, dashboard — anything that
 * renders a data-file-id attribute.
 *
 * For server-side chart rendering (Slack), use renderChartToJpeg in render-chart.ts.
 */
import { uploadFile } from '@/lib/object-store/client';

// eslint-disable-next-line no-restricted-syntax -- intentional session cache keyed by fileId (scoped per company/user via auth). Avoids re-uploading the same file view on every message send.
const fileImageCache = new Map<number, string>();

/**
 * Capture a rendered file view as an image and upload to S3.
 *
 * @param fileId          The file ID (used to locate `[data-file-id="${fileId}"]` in DOM)
 * @param captureFileView Function from useScreenshot hook that captures the DOM element to a Blob
 * @returns               Public S3 URL, or null if capture fails or element is not mounted
 */
export async function generateImageFromFile(
  fileId: number,
  captureFileView: (id: number) => Promise<Blob>,
): Promise<string | null> {
  if (fileImageCache.has(fileId)) return fileImageCache.get(fileId)!;

  try {
    const blob = await captureFileView(fileId);
    const file = new File([blob], 'screenshot.png', { type: 'image/png' });
    const { publicUrl } = await uploadFile(file, undefined, { keyType: 'charts' });
    fileImageCache.set(fileId, publicUrl);
    return publicUrl;
  } catch {
    return null;
  }
}
