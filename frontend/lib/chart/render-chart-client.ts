/**
 * Client-side chart image post-processing (browser-only).
 *
 * Scales a raw chart image to a max width, optionally overlays a
 * semi-transparent logo watermark, and encodes as JPEG.
 *
 * Used by: chart download button (chart-utils.ts), DevToolsPanel image
 * tools, any client-side chart export that needs JPEG + branding.
 *
 * Not safe for server/Node.js bundles — uses Canvas API.
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/**
 * Scale a chart image to fit within maxWidth (preserving aspect ratio),
 * optionally overlay a semi-transparent MinusX logo watermark in the
 * bottom-right corner, then encode as JPEG and return an object URL.
 *
 * @param source       Raw image — data URL string or Blob (e.g. PNG from ECharts getDataURL)
 * @param maxWidth     Scale output down to at most this width; never upscales
 * @param addWatermark Overlay semi-transparent logo in bottom-right corner
 * @param colorMode    Controls background fill colour and logo variant (dark/light)
 * @returns            Object URL pointing to the encoded JPEG blob
 */
export async function toJpegObjectUrl(
  source: Blob | string,
  maxWidth: number,
  addWatermark: boolean,
  colorMode: 'light' | 'dark',
): Promise<string> {
  const isBlobSrc = source instanceof Blob;
  const srcUrl = isBlobSrc ? URL.createObjectURL(source) : source;

  try {
    const img = await loadImage(srcUrl);

    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const canvasW = Math.round(img.naturalWidth * scale);
    const canvasH = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = colorMode === 'dark' ? '#161b22' : '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.drawImage(img, 0, 0, canvasW, canvasH);

    if (addWatermark) {
      try {
        const logoSrc = colorMode === 'dark' ? '/logox.svg' : '/logox_dark.svg';
        const logo = await loadImage(logoSrc);
        const logoH = Math.max(12, Math.round(canvasH * 0.08));
        const logoW = Math.round(logoH * (logo.naturalWidth / (logo.naturalHeight || 1)));
        const pad = Math.round(canvasH * 0.03);
        ctx.globalAlpha = 0.45;
        ctx.drawImage(logo, canvasW - logoW - pad, canvasH - logoH - pad, logoW, logoH);
        ctx.globalAlpha = 1;
      } catch {
        // Logo failed — output image without watermark
      }
    }

    return await new Promise<string>((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('Canvas toBlob failed'))),
        'image/jpeg',
        0.85,
      );
    });
  } finally {
    if (isBlobSrc) URL.revokeObjectURL(srcUrl);
  }
}
