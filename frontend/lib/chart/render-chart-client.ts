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
 * optionally add a bottom padding strip with a semi-transparent logo watermark
 * in the bottom-right corner, then encode as JPEG and return an object URL.
 *
 * @param source       Raw image — data URL string or Blob (e.g. PNG from ECharts getDataURL)
 * @param maxWidth     Scale output down to at most this width; never upscales
 * @param addWatermark Include the MinusX logo
 * @param colorMode    Controls background fill colour and logo variant (dark/light)
 * @param padding      When true, logo is placed in a dedicated bottom strip rather than
 *                     overlapping chart content. Strip height = logoH + pad (bottom-right corner).
 * @returns            Object URL pointing to the encoded JPEG blob
 */
export async function toJpegObjectUrl(
  source: Blob | string,
  maxWidth: number,
  addWatermark: boolean,
  colorMode: 'light' | 'dark',
  padding?: boolean,
): Promise<string> {
  const isBlobSrc = source instanceof Blob;
  const srcUrl = isBlobSrc ? URL.createObjectURL(source) : source;

  try {
    const img = await loadImage(srcUrl);

    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const canvasW = Math.round(img.naturalWidth * scale);
    const canvasH = Math.round(img.naturalHeight * scale);

    // When padding=true, add a constant P px strip on both top and bottom so the
    // chart is symmetrically framed. The watermark sits in the bottom-right P×P square.
    const P = 48; // constant padding in px
    const topPad    = padding && addWatermark ? P : 0;
    const bottomPad = padding && addWatermark ? P : 0;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = topPad + canvasH + bottomPad;
    const ctx = canvas.getContext('2d')!;

    const bg = colorMode === 'dark' ? '#161b22' : '#ffffff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvasW, topPad + canvasH + bottomPad);
    ctx.drawImage(img, 0, topPad, canvasW, canvasH);

    if (addWatermark) {
      try {
        const logoSrc = colorMode === 'dark' ? '/logox.svg' : '/logox_dark.svg';
        const logo = await loadImage(logoSrc);
        const aspect = logo.naturalWidth / (logo.naturalHeight || 1);
        ctx.globalAlpha = 0.65;
        if (padding) {
          // Logo sized to 60% of P, centred in the bottom-right P×P square.
          // With a square logo (logox is 65×65) this gives equal gaps on all four sides.
          const logoSize = Math.round(P * 0.6); // fits within P with 20% gap each side
          const logoW = Math.round(logoSize * aspect);
          const logoH = logoSize;
          const logoX = (canvasW - P) + Math.floor((P - logoW) / 2);
          const logoY = (topPad + canvasH) + Math.floor((P - logoH) / 2); // centred in bottom P strip
          ctx.drawImage(logo, logoX, logoY, logoW, logoH);
        } else {
          // Watermark overlaps chart at bottom-right (original behaviour).
          const overlapSize = Math.max(18, Math.min(28, Math.round(canvasH * 0.05)));
          const logoH = overlapSize;
          const logoW = Math.round(logoH * aspect);
          const gap = 14;
          ctx.drawImage(logo, canvasW - logoW - gap, canvasH - logoH - gap, logoW, logoH);
        }
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
