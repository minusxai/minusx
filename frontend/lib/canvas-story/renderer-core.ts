/**
 * Takumi renderer construction — shared by the browser main thread
 * (renderer.client.ts) and the raster Web Worker (raster.worker.ts).
 * Environment-agnostic: only fetch + the wasm module.
 */
import initWasm, { Renderer } from '@takumi-rs/wasm';
import { StoryRendererEngine } from '@/lib/canvas-story/types';

// Registration order defines the fallback chain: Inter first so unmatched sans
// stacks fall back to Inter (not mono). Serif files are registered under the
// concrete family names in Tailwind's font-serif stack so `font-serif` matches.
const BASE_FONTS: Array<{ url: string; name?: string }> = [
  { url: '/fonts/Inter-Variable.ttf' },
  { url: '/fonts/NotoSerif-Regular.ttf', name: 'Georgia' },
  { url: '/fonts/NotoSerif-Italic.ttf', name: 'Georgia' },
  { url: '/fonts/NotoSerif-Regular.ttf', name: 'ui-serif' },
  { url: '/fonts/NotoSerif-Italic.ttf', name: 'ui-serif' },
  { url: '/fonts/JetBrainsMono-Regular.ttf' },
  { url: '/fonts/JetBrainsMono-Bold.ttf' },
];

/** Resolve app-relative asset paths to absolute URLs: bundlers load workers from
 *  blob: URLs, where relative fetch has no usable base ("Failed to parse URL"). */
function absUrl(path: string): string {
  try {
    const origin = typeof location !== 'undefined' && location.origin && location.origin !== 'null' ? location.origin : '';
    return origin ? new URL(path, origin).href : path;
  } catch {
    return path;
  }
}

async function fetchBuffer(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(absUrl(url));
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/** Boot a takumi wasm renderer with the base font set registered. */
export async function createRenderer(): Promise<StoryRendererEngine> {
  await initWasm({ module_or_path: fetch(absUrl('/takumi/takumi_wasm_bg.wasm')) });
  const renderer = new Renderer();
  for (const font of BASE_FONTS) {
    const buf = await fetchBuffer(font.url);
    if (!buf) continue;
    try {
      await renderer.registerFont(font.name ? ({ name: font.name, data: new Uint8Array(buf) } as never) : new Uint8Array(buf));
    } catch { /* best-effort: a bad face must not sink the renderer */ }
  }
  return renderer as unknown as StoryRendererEngine;
}

/**
 * Register story-declared fonts: given @font-face CSS (from resolveImportFontCss),
 * fetch each `src: url(...)` binary and register it. Best-effort; the caller owns
 * the per-renderer dedup cache.
 */
export async function registerFontFaceCssCore(
  renderer: StoryRendererEngine,
  fontCss: string,
  registered: Set<string>,
): Promise<void> {
  const urls = [...fontCss.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)]
    .map(m => m[2])
    .filter(u => /\.(woff2?|ttf|otf)(\?|$)/i.test(u));
  for (const url of urls) {
    if (registered.has(url)) continue;
    registered.add(url);
    const buf = await fetchBuffer(url);
    if (!buf) continue;
    try {
      await renderer.registerFont(new Uint8Array(buf));
    } catch {
      // unsupported format — skip silently, fallback fonts cover it
    }
  }
}
